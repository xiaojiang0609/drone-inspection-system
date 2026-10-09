const STICKER_EMOJI = {
  heart: '♥',
  star: '✦',
  music: '♪',
  flower: '❀',
  cloud: '☁',
  smallHeart: '♡',
  sparkle: '✧',
  leaf: '🍃',
  butterfly: '🦋',
  smiley: '◡',
  grass: '🌱',
}

export default function StickerIcon({ type, x, y, scale = 1 }) {
  const emoji = STICKER_EMOJI[type]
  if (!emoji) return null

  const fontSize = 20 * scale

  return (
    <span
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        fontSize: `${fontSize}px`,
        transform: 'translate(-50%, -50%)',
        textShadow: '0 1px 3px rgba(0,0,0,0.3)',
        userSelect: 'none',
        lineHeight: 1,
      }}
    >
      {emoji}
    </span>
  )
}
