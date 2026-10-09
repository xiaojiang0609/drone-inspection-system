import { planJournalArrow } from './journal-arrows.js'

export function drawArrow(ctx, arrow, elements, detections, logicalHeight, options) {
  const path = planJournalArrow(arrow, elements, detections, logicalHeight, options)
  if (!path) return null
  ctx.save(); ctx.strokeStyle = path.style.color; ctx.lineWidth = path.style.lineWidth
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowColor = '#25201855'; ctx.shadowBlur = .8
  ctx.setLineDash([]); ctx.beginPath()
  if (path.style.dashed) {
    for (const chunk of path.bodyChunks) {
      ctx.moveTo(...chunk[0])
      for (const point of chunk.slice(1)) ctx.lineTo(...point)
    }
  } else {
    ctx.moveTo(...path.start); ctx.bezierCurveTo(...path.c1, ...path.c2, ...path.end)
  }
  ctx.stroke(); ctx.beginPath()
  for (const wing of path.headSegments) {
    ctx.moveTo(...wing.start); ctx.quadraticCurveTo(...wing.control, ...wing.end)
  }
  ctx.stroke(); ctx.restore()
  return path
}

export function drawDoodle(ctx, icon, size, color = '#fffaf1', paths) {
  ctx.save(); ctx.scale(size, size)
  ctx.lineWidth = 2.2 / size; ctx.strokeStyle = color; ctx.fillStyle = color
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.shadowColor = '#25201855'; ctx.shadowBlur = 2
  ctx.beginPath()
  if (['heart', 'smallHeart'].includes(icon)) {
    ctx.moveTo(0, .35)
    ctx.bezierCurveTo(-.64, -.04, -.32, -.56, 0, -.21)
    ctx.bezierCurveTo(.32, -.56, .64, -.04, 0, .35)
  } else if (icon === 'sparkle') {
    ctx.moveTo(0, -.46)
    ctx.quadraticCurveTo(.06, -.08, .32, 0)
    ctx.quadraticCurveTo(.06, .07, 0, .46)
    ctx.quadraticCurveTo(-.06, .08, -.32, 0)
    ctx.quadraticCurveTo(-.06, -.07, 0, -.46)
    ctx.fill()
    ctx.moveTo(.38, -.33); ctx.lineTo(.38, -.15)
    ctx.moveTo(.29, -.24); ctx.lineTo(.47, -.24)
  } else if (icon === 'star') {
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? .19 : .44, a = i * Math.PI / 5 - Math.PI / 2
      if (!i) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    ctx.closePath()
  } else if (icon === 'smiley') {
    ctx.arc(0, 0, .4, -.25, Math.PI * 1.88)
    ctx.moveTo(-.14, -.1); ctx.lineTo(-.14, -.03)
    ctx.moveTo(.13, -.12); ctx.lineTo(.13, -.05)
    ctx.moveTo(-.17, .12); ctx.quadraticCurveTo(0, .31, .18, .08)
    ctx.moveTo(.34, -.39); ctx.lineTo(.4, -.48)
  } else if (icon === 'music') {
    ctx.moveTo(-.18, .22); ctx.lineTo(-.18, -.3); ctx.lineTo(.26, -.4); ctx.lineTo(.26, .11)
    ctx.moveTo(-.18, -.18); ctx.lineTo(.26, -.28)
    ctx.moveTo(-.18, .22); ctx.ellipse(-.28, .25, .11, .07, -.3, 0, Math.PI * 2)
    ctx.moveTo(.26, .11); ctx.ellipse(.16, .14, .11, .07, -.3, 0, Math.PI * 2)
  } else if (icon === 'flower') {
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5
      ctx.moveTo(Math.cos(a) * .14, Math.sin(a) * .14)
      ctx.ellipse(Math.cos(a) * .27, Math.sin(a) * .27, .18, .11, a, 0, Math.PI * 2)
    }
    ctx.moveTo(.1, 0); ctx.arc(0, 0, .1, 0, Math.PI * 2)
  } else if (icon === 'leaf') {
    ctx.moveTo(-.31, .4); ctx.quadraticCurveTo(-.05, -.12, .35, -.4)
    ctx.moveTo(-.14, .15); ctx.bezierCurveTo(-.55, -.15, -.18, -.44, .35, -.4)
    ctx.bezierCurveTo(.47, .13, .12, .4, -.14, .15)
  } else if (icon === 'butterfly') {
    ctx.moveTo(0, -.1); ctx.bezierCurveTo(-.43, -.7, -.61, -.23, -.2, .02)
    ctx.bezierCurveTo(-.6, .34, -.11, .55, 0, .12)
    ctx.bezierCurveTo(.11, .55, .6, .34, .2, .02)
    ctx.bezierCurveTo(.61, -.23, .43, -.7, 0, -.1)
    ctx.moveTo(0, -.15); ctx.lineTo(0, .24)
    ctx.moveTo(0, -.15); ctx.quadraticCurveTo(-.05, -.37, -.17, -.37)
    ctx.moveTo(0, -.15); ctx.quadraticCurveTo(.05, -.37, .17, -.37)
  } else if (icon === 'cloud') {
    ctx.moveTo(-.3, .22); ctx.bezierCurveTo(-.65, .17, -.53, -.19, -.28, -.14)
    ctx.bezierCurveTo(-.23, -.55, .23, -.5, .29, -.18)
    ctx.bezierCurveTo(.6, -.2, .64, .23, .31, .23)
    ctx.lineTo(-.3, .22)
  } else if (icon === 'cup') {
    ctx.moveTo(-.31, -.12); ctx.quadraticCurveTo(-.31, .32, -.19, .34)
    ctx.quadraticCurveTo(-.05, .38, .11, .32); ctx.quadraticCurveTo(.2, .22, .2, -.12)
    ctx.moveTo(.2, -.06); ctx.bezierCurveTo(.46, -.14, .46, .25, .17, .23)
    ctx.moveTo(.2, -.12); ctx.ellipse(-.055, -.12, .255, .06, 0, 0, Math.PI * 2)
    ctx.moveTo(-.39, .42); ctx.quadraticCurveTo(-.06, .47, .3, .4)
    ctx.moveTo(-.17, -.24); ctx.bezierCurveTo(-.3, -.31, -.07, -.36, -.17, -.44)
    ctx.moveTo(.05, -.23); ctx.bezierCurveTo(-.06, -.31, .15, -.36, .06, -.42)
  } else if (icon === 'cutlery') {
    ctx.moveTo(-.35, -.4); ctx.lineTo(-.35, -.15)
    ctx.quadraticCurveTo(-.34, -.02, -.24, -.02); ctx.quadraticCurveTo(-.14, -.03, -.14, -.16)
    ctx.lineTo(-.14, -.4)
    ctx.moveTo(-.25, -.4); ctx.lineTo(-.24, -.13)
    ctx.moveTo(-.26, -.01); ctx.lineTo(-.28, .38); ctx.quadraticCurveTo(-.23, .45, -.2, .38)
    ctx.lineTo(-.21, -.01)
    ctx.moveTo(.16, -.4); ctx.lineTo(.37, -.39); ctx.lineTo(.35, -.09)
    ctx.quadraticCurveTo(.25, -.03, .15, -.1); ctx.closePath()
    ctx.moveTo(.21, -.32); ctx.lineTo(.2, -.16)
    ctx.moveTo(.29, -.32); ctx.lineTo(.28, -.16)
    ctx.moveTo(.23, -.07); ctx.lineTo(.2, .38); ctx.quadraticCurveTo(.25, .44, .29, .38)
    ctx.lineTo(.28, -.06)
  } else if (icon === 'chefHat') {
    ctx.moveTo(-.27, .15); ctx.lineTo(-.28, -.03)
    ctx.bezierCurveTo(-.48, -.02, -.45, -.32, -.25, -.29)
    ctx.bezierCurveTo(-.24, -.48, .08, -.47, .12, -.31)
    ctx.bezierCurveTo(.39, -.45, .48, -.09, .28, -.03)
    ctx.lineTo(.26, .16)
    ctx.moveTo(-.27, .13); ctx.lineTo(.27, .14); ctx.lineTo(.25, .34)
    ctx.quadraticCurveTo(0, .38, -.26, .33); ctx.closePath()
    ctx.moveTo(-.12, .05); ctx.lineTo(-.13, -.12)
    ctx.moveTo(.12, .06); ctx.lineTo(.14, -.1)
  } else if (icon === 'cake') {
    ctx.moveTo(-.35, -.11); ctx.quadraticCurveTo(0, -.16, .35, -.1)
    ctx.lineTo(.36, .32); ctx.quadraticCurveTo(0, .4, -.36, .32); ctx.closePath()
    ctx.moveTo(-.35, .03); ctx.quadraticCurveTo(-.26, .16, -.17, .05)
    ctx.quadraticCurveTo(-.07, .18, .02, .05); ctx.quadraticCurveTo(.13, .16, .2, .04)
    ctx.quadraticCurveTo(.28, .15, .35, .02)
    ctx.moveTo(-.34, .22); ctx.quadraticCurveTo(0, .27, .35, .2)
    ctx.moveTo(-.04, -.13); ctx.lineTo(-.04, -.3); ctx.lineTo(.05, -.3); ctx.lineTo(.05, -.13)
    ctx.moveTo(.01, -.34); ctx.bezierCurveTo(-.08, -.35, -.03, -.41, .02, -.46)
    ctx.bezierCurveTo(.09, -.4, .09, -.36, .01, -.34)
    ctx.moveTo(-.44, .42); ctx.quadraticCurveTo(0, .47, .43, .4)
  } else if (icon === 'camera') {
    ctx.moveTo(-.34, -.19); ctx.lineTo(-.18, -.19); ctx.lineTo(-.11, -.32)
    ctx.lineTo(.16, -.31); ctx.lineTo(.23, -.18); ctx.lineTo(.34, -.18)
    ctx.quadraticCurveTo(.42, -.18, .41, -.08); ctx.lineTo(.4, .24)
    ctx.quadraticCurveTo(.4, .31, .31, .31); ctx.lineTo(-.34, .3)
    ctx.quadraticCurveTo(-.42, .3, -.41, .21); ctx.lineTo(-.41, -.1)
    ctx.quadraticCurveTo(-.42, -.19, -.34, -.19)
    ctx.moveTo(.23, .05); ctx.ellipse(.03, .05, .2, .19, -.08, 0, Math.PI * 2)
    ctx.moveTo(.13, .05); ctx.arc(.03, .05, .1, 0, Math.PI * 2)
    ctx.moveTo(-.32, -.08); ctx.lineTo(-.22, -.08)
    ctx.moveTo(-.31, -.2); ctx.lineTo(-.3, -.28); ctx.lineTo(-.19, -.28)
  } else if (icon === 'paperPlane') {
    ctx.moveTo(-.43, -.13); ctx.lineTo(.42, -.38); ctx.lineTo(.22, .39)
    ctx.lineTo(-.04, .08); ctx.lineTo(-.24, .24); ctx.lineTo(-.21, -.02); ctx.closePath()
    ctx.moveTo(-.21, -.02); ctx.lineTo(.42, -.38); ctx.lineTo(-.04, .08)
    ctx.moveTo(-.42, .26); ctx.lineTo(-.34, .22)
    ctx.moveTo(-.32, .42); ctx.lineTo(-.24, .35)
  } else if (icon === 'sun') {
    ctx.moveTo(.24, 0); ctx.ellipse(0, 0, .24, .23, .08, 0, Math.PI * 2)
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4 + .04
      ctx.moveTo(Math.cos(angle) * .33, Math.sin(angle) * .33)
      ctx.lineTo(Math.cos(angle + .02) * .46, Math.sin(angle + .02) * .46)
    }
    ctx.moveTo(-.08, -.06); ctx.lineTo(-.08, -.01)
    ctx.moveTo(.08, -.06); ctx.lineTo(.08, -.01)
    ctx.moveTo(-.1, .08); ctx.quadraticCurveTo(0, .2, .11, .07)
  } else if (icon === 'rainbow') {
    for (const radius of [.39, .29, .19]) {
      ctx.moveTo(-radius, .17); ctx.arc(0, .17, radius, Math.PI, Math.PI * 2)
    }
    ctx.moveTo(-.43, .29); ctx.bezierCurveTo(-.49, .15, -.33, .08, -.29, .21)
    ctx.bezierCurveTo(-.17, .14, -.13, .32, -.24, .33); ctx.lineTo(-.43, .29)
    ctx.moveTo(.23, .32); ctx.bezierCurveTo(.11, .27, .18, .13, .29, .2)
    ctx.bezierCurveTo(.35, .05, .48, .17, .43, .3); ctx.lineTo(.23, .32)
  } else if (icon === 'paw') {
    ctx.moveTo(-.25, .29); ctx.bezierCurveTo(-.35, .11, -.16, .02, -.1, -.03)
    ctx.quadraticCurveTo(0, -.12, .11, -.03); ctx.bezierCurveTo(.19, .05, .36, .14, .25, .3)
    ctx.quadraticCurveTo(.18, .4, .03, .32); ctx.quadraticCurveTo(-.14, .4, -.25, .29)
    for (const [x, y, angle] of [[-.3, -.14, -.35], [-.12, -.3, -.15], [.12, -.29, .15], [.3, -.12, .35]]) {
      ctx.moveTo(x + Math.cos(angle) * .07, y + Math.sin(angle) * .07)
      ctx.ellipse(x, y, .07, .105, angle, 0, Math.PI * 2)
    }
  } else if (icon === 'cat') {
    ctx.moveTo(-.32, -.07); ctx.lineTo(-.3, -.4); ctx.lineTo(-.11, -.23)
    ctx.quadraticCurveTo(0, -.27, .12, -.23); ctx.lineTo(.3, -.4); ctx.lineTo(.33, -.04)
    ctx.bezierCurveTo(.42, .22, .18, .35, 0, .34)
    ctx.bezierCurveTo(-.25, .35, -.42, .2, -.32, -.07)
    ctx.moveTo(-.13, -.02); ctx.lineTo(-.13, .04)
    ctx.moveTo(.13, -.02); ctx.lineTo(.13, .04)
    ctx.moveTo(-.05, .1); ctx.lineTo(.05, .1); ctx.lineTo(0, .15); ctx.closePath()
    ctx.moveTo(0, .15); ctx.quadraticCurveTo(-.06, .24, -.12, .18)
    ctx.moveTo(0, .15); ctx.quadraticCurveTo(.05, .24, .12, .18)
    ctx.moveTo(-.23, .1); ctx.lineTo(-.45, .04)
    ctx.moveTo(-.23, .18); ctx.lineTo(-.44, .22)
    ctx.moveTo(.23, .1); ctx.lineTo(.45, .04)
    ctx.moveTo(.23, .18); ctx.lineTo(.44, .22)
  } else if (icon === 'sprout') {
    ctx.moveTo(.01, .4); ctx.quadraticCurveTo(.06, .04, -.02, -.09)
    ctx.moveTo(-.02, -.09); ctx.bezierCurveTo(-.25, -.02, -.42, -.19, -.39, -.35)
    ctx.bezierCurveTo(-.14, -.37, -.01, -.24, -.02, -.09)
    ctx.moveTo(.02, .02); ctx.bezierCurveTo(.03, -.23, .24, -.34, .4, -.29)
    ctx.bezierCurveTo(.39, -.1, .24, .07, .02, .02)
    ctx.moveTo(-.03, -.1); ctx.lineTo(-.27, -.26)
    ctx.moveTo(.03, .01); ctx.lineTo(.28, -.2)
    ctx.moveTo(-.16, .42); ctx.quadraticCurveTo(0, .36, .16, .41)
  } else if (icon === 'book') {
    ctx.moveTo(0, -.22); ctx.quadraticCurveTo(-.2, -.35, -.4, -.29)
    ctx.lineTo(-.4, .28); ctx.quadraticCurveTo(-.2, .2, 0, .34)
    ctx.quadraticCurveTo(.2, .2, .4, .28); ctx.lineTo(.4, -.29)
    ctx.quadraticCurveTo(.2, -.35, 0, -.22); ctx.lineTo(0, .34)
    ctx.moveTo(-.31, -.15); ctx.quadraticCurveTo(-.18, -.18, -.09, -.11)
    ctx.moveTo(-.31, -.02); ctx.quadraticCurveTo(-.18, -.05, -.09, .02)
    ctx.moveTo(.09, -.11); ctx.quadraticCurveTo(.2, -.17, .31, -.15)
    ctx.moveTo(.09, .02); ctx.quadraticCurveTo(.2, -.04, .31, -.02)
    ctx.moveTo(.24, -.3); ctx.lineTo(.24, -.06); ctx.lineTo(.19, -.11); ctx.lineTo(.14, -.06)
    ctx.lineTo(.14, -.27)
  } else if (icon === 'headphones') {
    ctx.moveTo(-.35, .08); ctx.bezierCurveTo(-.39, -.43, .37, -.44, .35, .08)
    ctx.moveTo(-.27, .03); ctx.bezierCurveTo(-.28, -.32, .28, -.33, .27, .03)
    ctx.moveTo(-.35, .01); ctx.quadraticCurveTo(-.44, .01, -.43, .12)
    ctx.lineTo(-.41, .24); ctx.quadraticCurveTo(-.39, .33, -.27, .28)
    ctx.lineTo(-.27, .03); ctx.closePath()
    ctx.moveTo(.35, .01); ctx.quadraticCurveTo(.44, .01, .43, .12)
    ctx.lineTo(.41, .24); ctx.quadraticCurveTo(.39, .33, .27, .28)
    ctx.lineTo(.27, .03); ctx.closePath()
    ctx.moveTo(.32, .3); ctx.bezierCurveTo(.33, .46, .1, .34, .09, .44)
  } else if (icon === 'bow') {
    ctx.moveTo(-.07, -.03); ctx.bezierCurveTo(-.27, -.32, -.44, -.32, -.4, -.05)
    ctx.bezierCurveTo(-.44, .23, -.21, .18, -.07, .06)
    ctx.moveTo(.07, -.03); ctx.bezierCurveTo(.27, -.31, .44, -.3, .4, -.04)
    ctx.bezierCurveTo(.43, .24, .21, .18, .07, .06)
    ctx.moveTo(.08, .02); ctx.ellipse(0, .02, .08, .075, -.08, 0, Math.PI * 2)
    ctx.moveTo(-.04, .1); ctx.lineTo(-.24, .39); ctx.lineTo(-.08, .33); ctx.lineTo(-.01, .44); ctx.lineTo(.03, .13)
    ctx.moveTo(.07, .1); ctx.lineTo(.27, .35); ctx.lineTo(.14, .33); ctx.lineTo(.1, .44); ctx.lineTo(.02, .15)
    ctx.moveTo(-.08, .01); ctx.lineTo(-.3, -.1)
    ctx.moveTo(.08, .01); ctx.lineTo(.3, -.09)
  } else if (icon === 'fruit') {
    ctx.moveTo(-.02, -.2); ctx.bezierCurveTo(-.31, -.38, -.43, -.08, -.31, .17)
    ctx.bezierCurveTo(-.23, .36, -.12, .41, .01, .33)
    ctx.bezierCurveTo(.16, .43, .3, .28, .34, .09)
    ctx.bezierCurveTo(.43, -.19, .2, -.35, -.02, -.2)
    ctx.moveTo(-.01, -.19); ctx.quadraticCurveTo(-.05, -.33, .04, -.42)
    ctx.moveTo(.01, -.29); ctx.bezierCurveTo(.08, -.44, .23, -.43, .28, -.37)
    ctx.quadraticCurveTo(.19, -.25, .01, -.29)
    ctx.moveTo(-.25, -.03); ctx.quadraticCurveTo(-.3, .1, -.22, .2)
  } else if (icon === 'berry') {
    ctx.moveTo(-.18, -.12); ctx.quadraticCurveTo(-.17, -.32, .05, -.39)
    ctx.moveTo(.15, -.05); ctx.quadraticCurveTo(.12, -.28, .05, -.39)
    ctx.moveTo(.01, -.33); ctx.quadraticCurveTo(-.12, -.45, -.25, -.36)
    ctx.quadraticCurveTo(-.18, -.21, .01, -.33)
    ctx.moveTo(.02, -.35); ctx.quadraticCurveTo(.17, -.45, .31, -.32)
    ctx.quadraticCurveTo(.16, -.24, .02, -.35)
    ctx.moveTo(.02, .09); ctx.ellipse(-.17, .09, .19, .22, -.12, 0, Math.PI * 2)
    ctx.moveTo(.36, .18); ctx.ellipse(.17, .18, .19, .21, .15, 0, Math.PI * 2)
    ctx.moveTo(-.22, -.04); ctx.lineTo(-.15, -.01)
    ctx.moveTo(.13, .04); ctx.lineTo(.2, .07)
  } else if (icon === 'bread') {
    ctx.moveTo(-.38, .19); ctx.bezierCurveTo(-.45, -.08, -.21, -.3, .09, -.29)
    ctx.bezierCurveTo(.29, -.31, .43, -.13, .4, .12)
    ctx.quadraticCurveTo(.37, .3, .2, .31); ctx.lineTo(-.23, .32)
    ctx.quadraticCurveTo(-.36, .3, -.38, .19)
    ctx.moveTo(-.24, -.1); ctx.quadraticCurveTo(-.14, -.05, -.12, .07)
    ctx.moveTo(-.06, -.17); ctx.quadraticCurveTo(.05, -.1, .06, .02)
    ctx.moveTo(.13, -.17); ctx.quadraticCurveTo(.23, -.09, .23, .03)
    ctx.moveTo(-.28, .22); ctx.quadraticCurveTo(0, .26, .28, .2)
  } else if (icon === 'steam') {
    ctx.moveTo(-.25, .3); ctx.bezierCurveTo(-.38, .08, -.1, -.03, -.22, -.3)
    ctx.moveTo(.02, .36); ctx.bezierCurveTo(-.15, .11, .15, -.07, .01, -.39)
    ctx.moveTo(.27, .23); ctx.bezierCurveTo(.14, .02, .38, -.08, .25, -.28)
  } else if (icon === 'rays') {
    ctx.moveTo(-.28, .12); ctx.quadraticCurveTo(-.36, -.02, -.4, -.16)
    ctx.moveTo(-.03, .02); ctx.quadraticCurveTo(-.04, -.17, .01, -.39)
    ctx.moveTo(.18, .12); ctx.quadraticCurveTo(.29, -.02, .4, -.1)
  } else if (icon === 'wave') {
    ctx.moveTo(-.42, -.1); ctx.bezierCurveTo(-.28, -.3, -.16, .12, 0, -.09)
    ctx.bezierCurveTo(.16, -.3, .28, .12, .42, -.08)
    ctx.moveTo(-.35, .14); ctx.bezierCurveTo(-.22, -.05, -.11, .36, .04, .15)
    ctx.bezierCurveTo(.19, -.05, .26, .33, .38, .17)
  } else if (icon === 'dots') {
    for (const [x, y, radius] of [[-.29, .08, .04], [-.01, -.06, .055], [.29, .08, .045]]) {
      ctx.moveTo(x + radius, y); ctx.arc(x, y, radius, 0, Math.PI * 2)
    }
  } else if (icon === 'custom' && Array.isArray(paths)) {
    const strokes = []
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
    for (const path of paths.slice(0, 8)) {
      if (!Array.isArray(path) || path.length < 2) continue
      const points = Array.from(path.slice(0, 48))
      if (!points.every(point => Array.isArray(point) && point.length === 2 &&
        Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
        point[0] >= 0 && point[0] <= 1000 && point[1] >= 0 && point[1] <= 1000)) continue
      strokes.push(points)
      for (const [x, y] of points) {
        x1 = Math.min(x1, x); y1 = Math.min(y1, y)
        x2 = Math.max(x2, x); y2 = Math.max(y2, y)
      }
    }
    const extent = Math.max(x2 - x1, y2 - y1)
    if (extent > 0) {
      const offsetX = (x2 - x1) / extent / 2, offsetY = (y2 - y1) / extent / 2
      for (const points of strokes) {
        for (const [i, [x, y]] of points.entries()) {
          const dx = ((x - x1) / extent - offsetX) * .9
          const dy = ((y - y1) / extent - offsetY) * .9
          if (!i) ctx.moveTo(dx, dy)
          else ctx.lineTo(dx, dy)
        }
      }
    }
  }
  ctx.stroke(); ctx.restore()
}
