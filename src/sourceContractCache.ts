import { sourceContractsSchema, type SourceContracts } from './contracts';

// This checksum detects local storage corruption; it is not an authentication signature.
function checksum(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return (value >>> 0).toString(16);
}
export async function cachedSourceContracts(read: (path: string) => Promise<unknown>, storage?: Pick<Storage, 'getItem'|'setItem'>): Promise<SourceContracts> {
  const meta = await read('/source-contracts/v1/meta') as {revision?: unknown};
  if (typeof meta.revision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(meta.revision)) throw Error('Invalid directory revision');
  const key = 'signalstudio:source-directory:v1';
  try {
    const entry = JSON.parse(storage?.getItem(key) || 'null');
    if (entry?.revision === meta.revision && checksum(entry.body) === entry.checksum) {
      const parsed = sourceContractsSchema.parse(JSON.parse(entry.body));
      if (parsed.revision === meta.revision) return parsed;
    }
  } catch { /* Corrupt/blocked storage cannot prevent a remote read. */ }
  const data = sourceContractsSchema.parse(await read('/source-contracts/v1'));
  if (data.revision !== meta.revision) throw Error('Directory changed while loading; retry');
  const body = JSON.stringify(data);
  try { storage?.setItem(key, JSON.stringify({revision:data.revision,body,checksum:checksum(body)})); } catch { /* Quota: remote data is still usable. */ }
  return data;
}
