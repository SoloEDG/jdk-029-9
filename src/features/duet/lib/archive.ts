import type { DuetTake } from '../model/types'

const name = 'night-session-duet'
const table = 'takes'

function connect() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 2)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(table)) db.createObjectStore(table, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await connect()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(table, mode)
      const request = operation(transaction.objectStore(table))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export const readDuetTakes = () => transact<DuetTake[]>('readonly', store => store.getAll())
export const writeDuetTake = (take: DuetTake) => transact('readwrite', store => store.put(take))
export const deleteDuetTake = (id: string) => transact('readwrite', store => store.delete(id))
