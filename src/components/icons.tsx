import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

const base = (size = 16): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
})

const mk = (d: React.ReactNode) =>
  function Icon({ size, ...p }: P) {
    return (
      <svg {...base(size)} {...p} aria-hidden="true">
        {d}
      </svg>
    )
  }

export const IconGrip = mk(
  <>
    <circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none" />
  </>,
)
export const IconChevron = mk(<path d="m9 6 6 6-6 6" />)
export const IconUp = mk(<path d="M12 19V5m-6 6 6-6 6 6" />)
export const IconDown = mk(<path d="M12 5v14m6-6-6 6-6-6" />)
export const IconIndent = mk(<path d="M4 6h16M10 12h10M10 18h10M4 10l3 2-3 2" />)
export const IconOutdent = mk(<path d="M4 6h16M10 12h10M10 18h10M7 10l-3 2 3 2" />)
export const IconPlus = mk(<path d="M12 5v14M5 12h14" />)
export const IconMore = mk(
  <>
    <circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </>,
)
export const IconTrash = mk(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />)
export const IconCopy = mk(
  <>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </>,
)
export const IconClose = mk(<path d="M6 6l12 12M18 6 6 18" />)
export const IconCheck = mk(<path d="m5 12 5 5 9-10" />)
export const IconFile = mk(
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </>,
)
export const IconFolder = mk(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />)
export const IconSettings = mk(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>,
)
export const IconOutline = mk(<path d="M4 6h10M8 12h12M8 18h9M4 12h.01M4 18h.01" />)
export const IconCards = mk(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <rect x="7" y="9" width="12" height="7" rx="1.5" />
  </>,
)
export const IconPen = mk(<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />)
export const IconNote = mk(
  <>
    <path d="M5 4h14a1 1 0 0 1 1 1v11l-4 4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
    <path d="M8 9h8M8 13h5" />
  </>,
)
export const IconTag = mk(
  <>
    <path d="M3 12V4h8l10 10-8 8z" />
    <circle cx="7.5" cy="8.5" r="1.3" />
  </>,
)
export const IconLink = mk(<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />)
export const IconSpark = mk(<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />)
export const IconLayers = mk(<path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5" />)
export const IconSearch = mk(
  <>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-4-4" />
  </>,
)
export const IconSidebar = mk(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </>,
)
export const IconRail = mk(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </>,
)
export const IconDownload = mk(<path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />)
export const IconUpload = mk(<path d="M12 20V9m-5 5 5-5 5 5M5 4h14" />)
export const IconUndo = mk(<path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />)
export const IconEye = mk(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
)
export const IconRefresh = mk(<path d="M20 11a8 8 0 0 0-14-5l-2 2m0-4v4h4M4 13a8 8 0 0 0 14 5l2-2m0 4v-4h-4" />)
export const IconCollapse = mk(<path d="M7 9l5-5 5 5M7 15l5 5 5-5" />)
export const IconExpand = mk(<path d="M7 4l5 5 5-5M7 20l5-5 5 5" />)
export const IconDuplicate = mk(
  <>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M4 16V6a2 2 0 0 1 2-2h10" />
  </>,
)
export const IconUnwrap = mk(<path d="M4 7h16M4 12h10M4 17h16M18 10l3 2-3 2" />)
