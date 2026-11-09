import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AboutPage } from './AboutPage'

describe('AboutPage', () => {
  it('shows author, version, GitHub links and license', () => {
    const html = renderToStaticMarkup(
      <AboutPage info={{ name: 'SolidProps', version: '0.1.0' }} />,
    )
    expect(html).toContain('skv')
    expect(html).toContain('0.1.0')
    expect(html).toContain('github.com/Marshmellond')
    expect(html).toContain('SolidProps')
    expect(html).toContain('MIT')
  })

  it('falls back when the version is unavailable', () => {
    expect(renderToStaticMarkup(<AboutPage info={null} />)).toContain('版本 —')
  })
})
