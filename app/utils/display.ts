/** Picture styles offered in Settings → Picture, as EmulatorJS 4.2.3 built-in shaders. */
export const PICTURE_STYLES = {
  sharp: 'disabled',
  smooth: 'bicubic',
  crt: 'crt-easymode.glslp',
  crtCurved: 'crt-geom.glslp',
} as const

export type PictureStyle = keyof typeof PICTURE_STYLES
export const PICTURE_SETTING = 'display.picture'

export function shaderFor(style: unknown): string | undefined {
  return typeof style === 'string' && Object.hasOwn(PICTURE_STYLES, style) ? PICTURE_STYLES[style as PictureStyle] : undefined
}
