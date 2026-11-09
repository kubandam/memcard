import { parseThumbnailIndex } from '~~/shared/utils/coverMatch'

const LISTING_URL = 'https://thumbnails.libretro.com/Sony%20-%20PlayStation/Named_Boxarts/'

/**
 * The list of PlayStation box-art file names from libretro-thumbnails, cached for a day.
 * The browser matches titles against this list locally, so no game title is sent anywhere
 * until the user explicitly asks to fetch one cover image.
 */
export default defineCachedEventHandler(
  async () => {
    const res = await fetch(LISTING_URL, { headers: { accept: 'text/html' } })
    if (!res.ok) throw createError({ statusCode: 502, statusMessage: 'Thumbnail index unavailable' })
    return { names: parseThumbnailIndex(await res.text()) }
  },
  { maxAge: 60 * 60 * 24, swr: true, name: 'covers-index' },
)
