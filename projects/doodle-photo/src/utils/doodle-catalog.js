export const DOODLE_OPTIONS = [
  ['sparkle', '星光'], ['heart', '爱心'], ['star', '星星'], ['smiley', '笑脸'],
  ['music', '音符'], ['flower', '小花'], ['leaf', '叶子'], ['butterfly', '蝴蝶'],
  ['cloud', '云朵'], ['smallHeart', '小爱心'], ['cup', '杯子'], ['cutlery', '餐具'],
  ['chefHat', '厨师帽'], ['cake', '小蛋糕'], ['camera', '相机'], ['paperPlane', '纸飞机'],
  ['sun', '太阳'], ['rainbow', '彩虹'], ['paw', '爪印'], ['cat', '猫咪'],
  ['sprout', '嫩芽'], ['book', '书本'], ['headphones', '耳机'], ['bow', '蝴蝶结'],
  ['fruit', '小水果'], ['berry', '小浆果'], ['bread', '面包'], ['steam', '热气'],
  ['rays', '小光芒'], ['wave', '波浪'], ['dots', '小圆点'],
].map(([id, label]) => ({ id, label }))

export const DOODLE_TYPES = new Set(DOODLE_OPTIONS.map(option => option.id))
export const FEATURE_DOODLES = new Set(['cup', 'cutlery', 'chefHat', 'cake', 'camera', 'paperPlane',
  'sun', 'rainbow', 'paw', 'cat', 'sprout', 'book', 'headphones', 'bow', 'fruit', 'berry', 'bread', 'custom'])
export const ACCENT_DOODLES = new Set(['rays', 'dots', 'wave', 'steam', 'sparkle', 'smallHeart', 'star'])

const motifsByTheme = {
  美食: ['rays', 'dots', 'smallHeart', 'sparkle', 'star', 'smiley', 'heart'],
  宠物: ['smallHeart', 'rays', 'dots', 'heart', 'sparkle', 'star', 'smiley'],
  旅行: ['rays', 'sparkle', 'dots', 'star', 'smallHeart', 'heart', 'smiley'],
  风景: ['rays', 'dots', 'sparkle', 'star', 'smallHeart', 'heart', 'smiley'],
  人物: ['smallHeart', 'rays', 'dots', 'heart', 'sparkle', 'star', 'smiley'],
  建筑: ['rays', 'dots', 'star', 'sparkle', 'smallHeart', 'heart', 'smiley'],
  静物: ['dots', 'rays', 'smallHeart', 'sparkle', 'star', 'heart', 'smiley'],
  其他: ['rays', 'dots', 'smallHeart', 'sparkle', 'star', 'heart', 'smiley'],
}

export function themedDoodles(theme, detections = []) {
  const related = []
  for (const detection of detections) {
    const label = String(detection?.label || '')
    // Object names come from recognition labels, never from a broad theme or caption.
    const fruitLabel = label.replace(/苹果(?:手机|电脑|手表)|apple\s+(?:iphone|macbook|watch)/gi, '')
    const beverageLabel = label.replace(/茶几|coffee\s+table/gi, '')
    const petLabel = label.replace(/热狗|\bhot\s+dogs?\b/gi, '')
    if (/草莓|蓝莓|树莓|覆盆子|黑莓|浆果|\b(?:berr(?:y|ies)|strawberr(?:y|ies)|blueberr(?:y|ies))\b/i.test(label)) related.push('berry')
    else if (/水果|苹果|香蕉|橙子|橘子|柠檬|葡萄|桃子|芒果|西瓜|梨子|\b(?:fruit|apple|banana|orange|lemon|grape|peach|mango|watermelon|pear)s?\b/i.test(fruitLabel)) related.push('fruit')
    if (/面包|吐司|法棍|可颂|贝果|欧包|\b(?:bread|toast|croissant|baguette|bagel)s?\b/i.test(label)) related.push('bread')
    if (/咖啡|奶茶|红茶|绿茶|抹茶|乌龙茶|茶杯|茶饮|热茶|凉茶|杯|饮料|牛奶|奶昔|可可|茶$|\b(?:coffee|tea|cup|mug|latte|cocoa|milk)\b/i.test(beverageLabel)) related.push('cup')
    if (/热气|蒸汽|刚出炉|滚烫|热(?:咖啡|茶|汤|饮|奶|可可|粥|面|饭|菜)|汤面|\bsteaming\b|\b(?:hot|warm)\s+(?:coffee|tea|cocoa|chocolate|milk|soup|noodles|bread)\b/i.test(label)
      && !/冰|冷|凉|\b(?:iced|cold)\b/i.test(label)) related.push('steam')
    if (/海边|海浪|海面|海滩|沙滩|大海|湖泊|湖面|河流|河面|波浪|浪花|\b(?:ocean|sea|beach|lake|river|wave)s?\b/i.test(label)) related.push('wave')
    if (/猫|\bcat\b/i.test(petLabel)) related.push('paw', 'cat')
    else if (/狗|宠物|\b(?:dog|pet)\b/i.test(petLabel)) related.push('paw')
    if (/花朵|鲜花|花束|小花|\bflowers?\b/i.test(label) || label === '花') related.push('flower', 'leaf')
    if (/绿植|植物|草地|树木|树叶|叶子|嫩芽|\b(?:plant|tree|leaf|leaves|grass)\b/i.test(label)) related.push('sprout', 'leaf')
    if (/书本|书籍|图书|读书|阅读|\bbooks?\b/i.test(label) || label === '书') related.push('book')
    if (/蛋糕|糕点|\b(?:cake|pastry|pastries)\b/i.test(label)) related.push('cake')
    if (/餐具|刀叉|叉子|勺子|\b(?:cutlery|fork|spoon)\b/i.test(label)) related.push('cutlery')
    if (/厨师帽|\bchef\s*hat\b/i.test(label)) related.push('chefHat')
    if (/相机|照相机|\bcamera\b/i.test(label)) related.push('camera')
    if (/纸飞机|\bpaper\s*plane\b/i.test(label)) related.push('paperPlane')
    if (/太阳|日出|日落|\b(?:sun|sunrise|sunset)\b/i.test(label)) related.push('sun', 'rays')
    if (/彩虹|\brainbow\b/i.test(label)) related.push('rainbow')
    if (/云朵|云层|白云|\bclouds?\b/i.test(label)) related.push('cloud')
    if (/蝴蝶结|\bbow\b/i.test(label)) related.push('bow')
    else if (/蝴蝶|\bbutterfly\b/i.test(label)) related.push('butterfly')
    if (/耳机|\bheadphones?\b/i.test(label)) related.push('headphones', 'music')
  }
  const themeMotifs = Object.hasOwn(motifsByTheme, theme) ? motifsByTheme[theme] : motifsByTheme.其他
  return [...new Set([...related, ...themeMotifs])]
}

export function validSketchPaths(paths) {
  const valid = Array.isArray(paths) && paths.length > 0 && paths.length <= 8
    && Array.from(paths).every(path => Array.isArray(path) && path.length >= 2 && path.length <= 48
      && Array.from(path).every(point => Array.isArray(point) && point.length === 2
        && Array.from(point).every(value => Number.isFinite(value) && value >= 0 && value <= 1000)))
  if (!valid) return false
  const points = paths.flat(), first = points[0]
  return points.some(point => point[0] !== first[0] || point[1] !== first[1])
}
