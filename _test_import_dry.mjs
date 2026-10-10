console.log('test env ALI_OSS_ACCESS_KEY_ID:', process.env.ALI_OSS_ACCESS_KEY_ID?.slice(0,8))
console.log('typeof process.env:', typeof process.env)
try {
  const mod = await import('./dry_run.mjs')
  console.log('import succeeded')
} catch (e) {
  console.log('import failed:', e.message)
}
