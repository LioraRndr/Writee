let seq = 0
export function uid(prefix = '') {
  seq = (seq + 1) % 1679616
  return prefix + Date.now().toString(36) + seq.toString(36).padStart(4, '0') + Math.random().toString(36).slice(2, 6)
}
