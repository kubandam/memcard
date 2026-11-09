export default defineEventHandler((event) => ownerAction(event, ({ id, svc }) => svc.listShares(id)))
