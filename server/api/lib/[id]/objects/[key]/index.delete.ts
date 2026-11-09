export default defineEventHandler((event) =>
  ownerAction(event, async ({ id, key, svc }) => {
    await svc.deleteObject(id, key!)
    return {}
  }),
)
