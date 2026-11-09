import { Github, Layers, Monitor, Package, Scale, User } from 'lucide-react'
import type { AppInfo } from '../types'

const PROFILE = 'https://github.com/Marshmellond'
const REPOSITORY = 'https://github.com/Marshmellond/SolidProps'

export interface AboutPageProps {
  info: AppInfo | null
}

function open(url: string) {
  window.cadweave?.openExternal?.(url)
}

export function AboutPage({ info }: AboutPageProps) {
  return (
    <section className="about">
      <div className="about-hero">
        <div className="about-logo" aria-hidden="true">
          <span>S</span>
          <i />
        </div>
        <div>
          <h2>SolidProps</h2>
          <p>SolidWorks 文档属性工作台</p>
          <span className="about-version">版本 {info?.version ?? '—'}</span>
        </div>
      </div>
      <dl className="about-grid">
        <div>
          <dt>
            <User size={14} />
            作者
          </dt>
          <dd>skv</dd>
        </div>
        <div>
          <dt>
            <Github size={14} />
            GitHub
          </dt>
          <dd>
            <button type="button" className="about-link" onClick={() => open(PROFILE)}>
              github.com/Marshmellond
            </button>
          </dd>
        </div>
        <div>
          <dt>
            <Package size={14} />
            项目仓库
          </dt>
          <dd>
            <button type="button" className="about-link" onClick={() => open(REPOSITORY)}>
              {REPOSITORY}
            </button>
          </dd>
        </div>
        <div>
          <dt>
            <Scale size={14} />
            开源协议
          </dt>
          <dd>MIT License</dd>
        </div>
        <div>
          <dt>
            <Monitor size={14} />
            运行环境
          </dt>
          <dd>Windows 10 / 11（64 位） · SolidWorks 2018 及以上</dd>
        </div>
        <div>
          <dt>
            <Layers size={14} />
            技术栈
          </dt>
          <dd>Electron · React · TypeScript · Python</dd>
        </div>
      </dl>
      <p className="about-footnote">Copyright © 2026 skv · 本软件以 MIT 协议开源</p>
    </section>
  )
}
