export function wrapJournalText(text, maxWidth, measure) {
  const lines = []
  let line = ''
  for (const char of String(text || '')) {
    if (char === '\n' || (line && measure(line + char) > maxWidth)) {
      lines.push(line)
      line = char === '\n' ? '' : char
    } else line += char
  }
  if (line) lines.push(line)
  if (lines.length > 1 && lines.at(-1).length === 1 && lines.at(-2).length > 2) {
    const previous = lines[lines.length - 2]
    const combined = previous.slice(-2) + lines.at(-1)
    if (measure(combined) <= maxWidth) {
      lines[lines.length - 2] = previous.slice(0, -2)
      lines[lines.length - 1] = combined
    }
  }
  return lines
}

export function journalTextHeight(type, text, width, fontSize, measure) {
  const content = String(text || '').replace(/([，,])(?!\n)/g, '$1\n')
  const paddingX = type === 'bubble' ? 48 : type === 'note' ? 56 : 12
  const paddingY = type === 'bubble' ? 64 : type === 'note' ? 104 : 24
  const lineHeight = type === 'bubble' || type === 'note' ? 1.5 : 1.35
  const lines = wrapJournalText(content, width - paddingX, value => measure(value, fontSize))
  return Math.max(1, lines.length) * fontSize * lineHeight + paddingY
}

export function resizeJournalTextElement(element, measure) {
  if (!['text', 'note', 'bubble'].includes(element.type)) return element
  const fontSize = element.fontSize || (element.type === 'text' ? 29 : 32)
  return { ...element,
    height: journalTextHeight(element.type, element.text, element.width, fontSize, measure) / (element.aspect || 1) }
}
