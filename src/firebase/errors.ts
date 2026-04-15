// Firebase errors removed
export class FirestorePermissionError extends Error {
  constructor(context: any) { super('Permission error'); this.name = 'FirebaseError'; }
}
