/**
 * Minimal TypeScript declarations for the Web NFC API (W3C spec).
 *
 * The API is available only in Chrome 89+ on Android. Not available on iOS,
 * Firefox, or desktop Chrome. Always check `'NDEFReader' in window` before use.
 *
 * Spec: https://w3c.github.io/web-nfc/
 */

interface NDEFRecord {
  readonly recordType: string        // "url", "text", "mime", "smart-poster", etc.
  readonly mediaType:  string | null
  readonly id:         string | null
  readonly data:       DataView | null
  readonly encoding:   string | null
  readonly lang:       string | null
  toRecords(): NDEFRecord[]
}

interface NDEFMessage {
  readonly records: ReadonlyArray<NDEFRecord>
}

interface NDEFReadingEvent extends Event {
  readonly serialNumber: string
  readonly message:      NDEFMessage
}

interface NDEFScanOptions {
  signal?: AbortSignal
}

interface NDEFWriteOptions {
  overwrite?: boolean
  signal?:    AbortSignal
}

interface NDEFReader extends EventTarget {
  onreading:      ((this: NDEFReader, ev: NDEFReadingEvent) => any) | null
  onreadingerror: ((this: NDEFReader, ev: Event)            => any) | null

  scan(options?: NDEFScanOptions): Promise<void>
  write(message: NDEFMessageInit | string, options?: NDEFWriteOptions): Promise<void>
  makeReadOnly(options?: { signal?: AbortSignal }): Promise<void>
}

interface NDEFRecordInit {
  recordType: string
  mediaType?: string
  id?:        string
  data?:      string | BufferSource | NDEFMessageInit
  encoding?:  string
  lang?:      string
}

interface NDEFMessageInit {
  records: NDEFRecordInit[]
}

declare var NDEFReader: {
  prototype: NDEFReader
  new(): NDEFReader
}
