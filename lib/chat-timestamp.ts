export const chatTimestampMicroseconds = (value: string) => {
  const fraction = value.match(/T\d{2}:\d{2}:\d{2}\.(\d+)/)?.[1] ?? ''
  return Date.parse(value) * 1000 + Number(fraction.slice(3, 6).padEnd(3, '0') || 0)
}
