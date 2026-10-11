/** Restrict imported markup independently of the workspace's script policy. */
export function embedDocument(html, scripts = false) {
  const policy = `default-src 'none'; script-src ${scripts ? "'unsafe-inline'" : "'none'"}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  // Parsed before supplied content. Later policies can only tighten it.
  // The iframe sandbox separately isolates the document's origin.
  return `<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`
    + String(html).replace(/^\s*<!doctype[^>]*>/i, '');
}
