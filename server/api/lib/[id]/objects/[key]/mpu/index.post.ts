export default defineEventHandler((event) => ownerAction(event, ({ id, key, svc }) => svc.createUpload(id, key!)))
