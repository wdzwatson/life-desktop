const cjkOrPunctuation = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af，。！？；：、】【、】【（）《》〈〉“”‘’…—]/u

export function joinOcrWords(words: Array<{ text: string }>) {
  return words.reduce((text, word) => {
    const next = word.text.trim()
    if (!next) return text
    if (!text) return next
    return cjkOrPunctuation.test(text) || cjkOrPunctuation.test(next)
      ? `${text}${next}`
      : `${text} ${next}`
  }, '')
}
