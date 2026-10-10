declare module 'xlsx' {
  const XLSX: {
    read(
      data: ArrayBuffer,
      opts?: { type: 'array' | 'buffer' | 'base64' | 'binary' | 'string' },
    ): {
      SheetNames: string[]
      Sheets: Record<string, unknown>
    }
    utils: {
      sheet_to_json<T = Record<string, string>>(
        sheet: unknown,
        opts?: { defval?: string },
      ): T[]
    }
  }
  export = XLSX
}