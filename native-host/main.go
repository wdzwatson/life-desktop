package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"sync"
)

const (
	protocolVersion = 1
	maxMessageBytes = 1024 * 1024
	extensionOrigin = "chrome-extension://lchijjcgobbcejjdpjanejocndgmfmnd/"
)

type bridgeConfig struct {
	ProtocolVersion int    `json:"protocolVersion"`
	Port            int    `json:"port"`
	Token           string `json:"token"`
}

type hostHello struct {
	Type            string `json:"type"`
	ProtocolVersion int    `json:"protocolVersion"`
	Token           string `json:"token"`
	Origin          string `json:"origin"`
}

func main() {
	if err := run(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) < 2 || os.Args[1] != extensionOrigin {
		return errors.New("missing or invalid Chrome extension origin")
	}
	config, err := readBridgeConfig()
	if err != nil {
		return err
	}
	connection, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", config.Port))
	if err != nil {
		return fmt.Errorf("connect to LifeOS bridge: %w", err)
	}
	defer connection.Close()

	lineWriter := bufio.NewWriter(connection)
	hello, err := json.Marshal(hostHello{
		Type:            "host.hello",
		ProtocolVersion: protocolVersion,
		Token:           config.Token,
		Origin:          extensionOrigin,
	})
	if err != nil {
		return err
	}
	if _, err := lineWriter.Write(append(hello, '\n')); err != nil {
		return fmt.Errorf("send bridge handshake: %w", err)
	}
	if err := lineWriter.Flush(); err != nil {
		return fmt.Errorf("flush bridge handshake: %w", err)
	}

	var outputMu sync.Mutex
	chromeDone := make(chan error, 1)
	bridgeDone := make(chan error, 1)
	go func() { chromeDone <- proxyChromeToBridge(connection) }()
	go func() { bridgeDone <- proxyBridgeToChrome(connection, &outputMu) }()

	select {
	case err := <-chromeDone:
		_ = connection.Close()
		if err != nil && !errors.Is(err, io.EOF) {
			return fmt.Errorf("read Chrome message: %w", err)
		}
		return nil
	case err := <-bridgeDone:
		_ = connection.Close()
		if err != nil && !errors.Is(err, io.EOF) {
			return fmt.Errorf("read LifeOS bridge message: %w", err)
		}
		return nil
	}
}

func readBridgeConfig() (bridgeConfig, error) {
	configPath := bridgeConfigPath()
	contents, err := os.ReadFile(configPath)
	if err != nil {
		return bridgeConfig{}, fmt.Errorf("read LifeOS bridge config: %w", err)
	}
	var config bridgeConfig
	if err := json.Unmarshal(contents, &config); err != nil {
		return bridgeConfig{}, fmt.Errorf("parse LifeOS bridge config: %w", err)
	}
	if config.ProtocolVersion != protocolVersion || config.Port < 1 || config.Port > 65535 || len(config.Token) != 64 {
		return bridgeConfig{}, errors.New("invalid LifeOS bridge config")
	}
	return config, nil
}

func bridgeConfigPath() string {
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "windows" {
		base := os.Getenv("LOCALAPPDATA")
		if base == "" {
			base = filepath.Join(home, "AppData", "Local")
		}
		return filepath.Join(base, "LifeOS", "BrowserControl", "bridge.json")
	}
	if runtime.GOOS == "darwin" {
		return filepath.Join(home, "Library", "Application Support", "LifeOS", "BrowserControl", "bridge.json")
	}
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "lifeos", "browser-control", "bridge.json")
}

func proxyChromeToBridge(connection net.Conn) error {
	decoder := newNativeDecoder()
	buffer := make([]byte, 32*1024)
	for {
		count, err := os.Stdin.Read(buffer)
		if count > 0 {
			messages, decodeErr := decoder.push(buffer[:count])
			if decodeErr != nil {
				return decodeErr
			}
			for _, message := range messages {
				payload, marshalErr := json.Marshal(message)
				if marshalErr != nil {
					return marshalErr
				}
				if len(payload) > maxMessageBytes {
					return errors.New("Chrome message is too large")
				}
				if _, writeErr := connection.Write(append(payload, '\n')); writeErr != nil {
					return writeErr
				}
			}
		}
		if err != nil {
			return err
		}
	}
}

func proxyBridgeToChrome(connection net.Conn, outputMu *sync.Mutex) error {
	decoder := bufio.NewScanner(connection)
	decoder.Buffer(make([]byte, 0, 64*1024), maxMessageBytes)
	for decoder.Scan() {
		line := decoder.Bytes()
		if len(line) == 0 {
			continue
		}
		var message json.RawMessage
		if err := json.Unmarshal(line, &message); err != nil {
			return err
		}
		if err := writeNativeMessage(message, outputMu); err != nil {
			return err
		}
	}
	if err := decoder.Err(); err != nil {
		return err
	}
	return io.EOF
}

func writeNativeMessage(message json.RawMessage, outputMu *sync.Mutex) error {
	if len(message) == 0 || len(message) > maxMessageBytes {
		return errors.New("bridge message is too large")
	}
	var length [4]byte
	binary.LittleEndian.PutUint32(length[:], uint32(len(message)))
	outputMu.Lock()
	defer outputMu.Unlock()
	if _, err := os.Stdout.Write(length[:]); err != nil {
		return err
	}
	_, err := os.Stdout.Write(message)
	return err
}

type nativeDecoder struct {
	buffer []byte
}

func newNativeDecoder() *nativeDecoder {
	return &nativeDecoder{buffer: make([]byte, 0, 4096)}
}

func (decoder *nativeDecoder) push(chunk []byte) ([]json.RawMessage, error) {
	decoder.buffer = append(decoder.buffer, chunk...)
	if len(decoder.buffer) > maxMessageBytes*2 {
		return nil, errors.New("Chrome message buffer is too large")
	}
	var messages []json.RawMessage
	for len(decoder.buffer) >= 4 {
		length := binary.LittleEndian.Uint32(decoder.buffer[:4])
		if length == 0 || length > maxMessageBytes {
			return nil, errors.New("invalid Chrome message length")
		}
		frameLength := 4 + int(length)
		if len(decoder.buffer) < frameLength {
			break
		}
		payload := append(json.RawMessage(nil), decoder.buffer[4:frameLength]...)
		if !json.Valid(payload) {
			return nil, errors.New("invalid Chrome JSON message")
		}
		messages = append(messages, payload)
		decoder.buffer = decoder.buffer[frameLength:]
	}
	return messages, nil
}
