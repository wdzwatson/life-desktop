import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  TextRun,
  type IParagraphOptions,
  type IRunPropertiesOptions,
  type ParagraphChild,
} from 'docx'
import { ElementType, parseDocument, type ChildNode, type Element } from 'htmlparser2'

type AnnotationKind = 'translation' | 'underline' | 'note'

type BlockContext = {
  annotationKind?: AnnotationKind
  listDepth?: number
}

const ANNOTATION_DOCX_STYLES: Record<
  AnnotationKind,
  { fill: string; border: string; text: string; label: string }
> = {
  translation: { fill: 'EFF6FF', border: '2563EB', text: '1D4ED8', label: 'T Translation' },
  underline: { fill: 'FFFBEB', border: 'D97706', text: 'B45309', label: 'U Underline' },
  note: { fill: 'F0FDF4', border: '16A34A', text: '15803D', label: 'N Note' },
}

const headingLevels = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const

const isText = (node: ChildNode) => node.type === ElementType.Text
const isTag = (node: ChildNode): node is Element =>
  node.type === ElementType.Tag ||
  node.type === ElementType.Script ||
  node.type === ElementType.Style

const normalizeText = (value: string, preserveWhitespace = false) =>
  preserveWhitespace ? value.replace(/\r\n?/g, '\n') : value.replace(/\s+/g, ' ')

const getTextContent = (nodes: ChildNode[]): string =>
  nodes
    .map((node) => {
      if (isText(node)) return 'data' in node ? node.data : ''
      return 'children' in node ? getTextContent(node.children) : ''
    })
    .join('')

const getInlineChildren = (
  nodes: ChildNode[],
  style: IRunPropertiesOptions = {},
  preserveWhitespace = false,
): ParagraphChild[] => {
  const children: ParagraphChild[] = []
  nodes.forEach((node) => {
    if (isText(node)) {
      const text = normalizeText('data' in node ? node.data : '', preserveWhitespace)
      if (text) children.push(new TextRun({ text, ...style }))
      return
    }
    if (!isTag(node)) return
    const name = node.name.toLowerCase()
    if (name === 'br') {
      children.push(new TextRun({ break: 1 }))
      return
    }
    if (name === 'a' && node.attribs.href) {
      const text = normalizeText(getTextContent(node.children)).trim() || node.attribs.href
      children.push(
        new ExternalHyperlink({
          link: node.attribs.href,
          children: [new TextRun({ text, color: '0969DA', underline: {}, ...style })],
        }),
      )
      return
    }
    const nextStyle: IRunPropertiesOptions = {
      ...style,
      ...(name === 'strong' || name === 'b' ? { bold: true } : {}),
      ...(name === 'em' || name === 'i' ? { italics: true } : {}),
      ...(name === 'u' ? { underline: {} } : {}),
      ...(name === 's' || name === 'del' ? { strike: true } : {}),
      ...(name === 'code'
        ? { font: 'Consolas', shading: { fill: 'F3F4F6', type: ShadingType.CLEAR } }
        : {}),
    }
    children.push(...getInlineChildren(node.children, nextStyle, preserveWhitespace || name === 'code'))
  })
  return children
}

const getAnnotationKind = (element: Element): AnnotationKind | undefined => {
  const semanticKind = element.attribs['data-reader-annotation-kind']
  if (semanticKind === 'translation' || semanticKind === 'underline' || semanticKind === 'note') {
    return semanticKind
  }
  const classes = new Set((element.attribs.class || '').split(/\s+/))
  if (classes.has('is-translation')) return 'translation'
  if (classes.has('is-underline')) return 'underline'
  if (classes.has('is-note')) return 'note'
  return undefined
}

const getParagraphDecoration = (kind?: AnnotationKind): Partial<IParagraphOptions> => {
  if (!kind) return {}
  const style = ANNOTATION_DOCX_STYLES[kind]
  return {
    shading: { fill: style.fill, type: ShadingType.CLEAR },
    border: {
      left: { style: BorderStyle.SINGLE, color: style.border, size: 18, space: 8 },
    },
    keepLines: true,
  }
}

const createParagraph = (
  children: ParagraphChild[],
  context: BlockContext,
  options: Partial<IParagraphOptions> = {},
) =>
  new Paragraph({
    children: children.length ? children : [new TextRun('')],
    spacing: { after: 140, line: 320 },
    ...getParagraphDecoration(context.annotationKind),
    ...options,
  })

const getDirectListChildren = (element: Element) =>
  element.children.filter(
    (child): child is Element => isTag(child) && child.name.toLowerCase() === 'li',
  )

const renderList = (element: Element, context: BlockContext): Paragraph[] => {
  const ordered = element.name.toLowerCase() === 'ol'
  const depth = Math.max(0, context.listDepth || 0)
  const paragraphs: Paragraph[] = []
  getDirectListChildren(element).forEach((item, itemIndex) => {
    const inlineNodes = item.children.filter(
      (child) => !isTag(child) || !['ul', 'ol'].includes(child.name.toLowerCase()),
    )
    const inlineChildren = getInlineChildren(inlineNodes)
    const usesNativeListLevel = depth < 9
    paragraphs.push(
      createParagraph(
        usesNativeListLevel
          ? inlineChildren
          : [new TextRun(ordered ? `${itemIndex + 1}. ` : '- '), ...inlineChildren],
        context,
        {
          ...(usesNativeListLevel
            ? ordered
              ? { numbering: { reference: 'note-export-numbering', level: depth } }
              : { bullet: { level: depth } }
            : { indent: { left: 720 + depth * 360, hanging: 260 } }),
        },
      ),
    )
    item.children.forEach((child) => {
      if (isTag(child) && ['ul', 'ol'].includes(child.name.toLowerCase())) {
        paragraphs.push(...renderList(child, { ...context, listDepth: depth + 1 }))
      }
    })
  })
  return paragraphs
}

const renderTable = (element: Element, context: BlockContext): Paragraph[] => {
  const rows = element.children.flatMap((section) => {
    if (!isTag(section)) return []
    if (section.name.toLowerCase() === 'tr') return [section]
    return section.children.filter(
      (child): child is Element => isTag(child) && child.name.toLowerCase() === 'tr',
    )
  })
  return rows.map((row) => {
    const cells = row.children
      .filter(
        (child): child is Element =>
          isTag(child) && ['th', 'td'].includes(child.name.toLowerCase()),
      )
      .map((cell) => normalizeText(getTextContent(cell.children)).trim())
    return createParagraph([new TextRun(cells.join(' | '))], context)
  })
}

const renderBlocks = (nodes: ChildNode[], context: BlockContext = {}): Paragraph[] => {
  const paragraphs: Paragraph[] = []
  nodes.forEach((node) => {
    if (isText(node)) {
      const text = normalizeText('data' in node ? node.data : '').trim()
      if (text) paragraphs.push(createParagraph([new TextRun(text)], context))
      return
    }
    if (!isTag(node)) return
    const name = node.name.toLowerCase()
    const classes = new Set((node.attribs.class || '').split(/\s+/))
    if (name === 'script' || name === 'style' || classes.has('reader-export-annotation__icon')) {
      return
    }
    if (/^h[1-6]$/.test(name)) {
      paragraphs.push(
        createParagraph(getInlineChildren(node.children), context, {
          heading: headingLevels[Number(name.slice(1)) - 1],
          keepNext: true,
        }),
      )
      return
    }
    if (name === 'ul' || name === 'ol') {
      paragraphs.push(...renderList(node, context))
      return
    }
    if (name === 'table') {
      paragraphs.push(...renderTable(node, context))
      return
    }
    if (name === 'article') {
      const kind = getAnnotationKind(node)
      if (kind) {
        const style = ANNOTATION_DOCX_STYLES[kind]
        paragraphs.push(
          createParagraph(
            [new TextRun({ text: style.label, bold: true, color: style.text })],
            { ...context, annotationKind: kind },
            { keepNext: true },
          ),
        )
      }
      paragraphs.push(...renderBlocks(node.children, { ...context, annotationKind: kind }))
      return
    }
    if (name === 'p' || name === 'blockquote' || name === 'pre') {
      paragraphs.push(
        createParagraph(
          getInlineChildren(
            node.children,
            name === 'blockquote' ? { italics: true, color: '57606A' } : {},
            name === 'pre',
          ),
          context,
          name === 'blockquote' && !context.annotationKind
            ? {
                border: {
                  left: { style: BorderStyle.SINGLE, color: 'D0D7DE', size: 12, space: 8 },
                },
              }
            : {},
        ),
      )
      return
    }
    paragraphs.push(...renderBlocks(node.children, context))
  })
  return paragraphs
}

const findBody = (nodes: ChildNode[]): Element | null => {
  for (const node of nodes) {
    if (!isTag(node)) continue
    if (node.name.toLowerCase() === 'body') return node
    const nested = findBody(node.children)
    if (nested) return nested
  }
  return null
}

export const buildNoteExportDocx = async (title: string, htmlContent: string) => {
  const parsed = parseDocument(htmlContent || '')
  const body = findBody(parsed.children)
  const contentNodes = body?.children || parsed.children
  const bodyContainsTitle = contentNodes.some(
    (node) => isTag(node) && node.name.toLowerCase() === 'h1',
  )
  const children = [
    ...(bodyContainsTitle
      ? []
      : [
          new Paragraph({
            children: [new TextRun(title || 'Note')],
            heading: HeadingLevel.TITLE,
            spacing: { after: 280 },
          }),
        ]),
    ...renderBlocks(contentNodes),
  ]
  const numberingLevels = Array.from({ length: 9 }, (_, level) => ({
    level,
    format: LevelFormat.DECIMAL,
    text: `%${level + 1}.`,
    alignment: AlignmentType.START,
    style: { paragraph: { indent: { left: 720 + level * 360, hanging: 260 } } },
  }))
  const document = new Document({
    title,
    creator: 'LifeOS',
    numbering: {
      config: [{ reference: 'note-export-numbering', levels: numberingLevels }],
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } },
        },
        children,
      },
    ],
  })
  return Packer.toBuffer(document)
}
