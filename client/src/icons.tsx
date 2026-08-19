/**
 * Feather-style line icons — the same set pi-web-ui uses (react-icons/fi).
 * Hand-written inline SVGs so the plugin needs no icon dependency and the
 * look matches pi-web-ui 1:1.
 */
import * as React from 'react'

interface IconProps {
  size?: number
  className?: string
}

function base(props: IconProps, children: React.ReactNode): React.ReactElement {
  return React.createElement(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width: props.size ?? 16,
      height: props.size ?? 16,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      className: props.className,
    },
    children,
  )
}

export function FiFolder(p: IconProps) {
  return base(p, React.createElement('path', { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' }))
}
export function FiFile(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('path', { d: 'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z' }),
    React.createElement('polyline', { points: '13 2 13 9 20 9' }),
  ))
}
export function FiChevronRight(p: IconProps) {
  return base(p, React.createElement('polyline', { points: '9 18 15 12 9 6' }))
}
export function FiChevronDown(p: IconProps) {
  return base(p, React.createElement('polyline', { points: '6 9 12 15 18 9' }))
}
export function FiLink(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }),
    React.createElement('path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }),
  ))
}
export function FiPlus(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('line', { x1: '12', y1: '5', x2: '12', y2: '19' }),
    React.createElement('line', { x1: '5', y1: '12', x2: '19', y2: '12' }),
  ))
}
export function FiDownload(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
    React.createElement('polyline', { points: '7 10 12 15 17 10' }),
    React.createElement('line', { x1: '12', y1: '15', x2: '12', y2: '3' }),
  ))
}
export function FiRefreshCw(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('polyline', { points: '23 4 23 10 17 10' }),
    React.createElement('polyline', { points: '1 20 1 14 7 14' }),
    React.createElement('path', { d: 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15' }),
  ))
}
export function FiTerminal(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('polyline', { points: '4 17 10 11 4 5' }),
    React.createElement('line', { x1: '12', y1: '19', x2: '20', y2: '19' }),
  ))
}
export function FiGitBranch(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('line', { x1: '6', y1: '3', x2: '6', y2: '15' }),
    React.createElement('circle', { cx: '18', cy: '6', r: '3' }),
    React.createElement('circle', { cx: '6', cy: '18', r: '3' }),
    React.createElement('path', { d: 'M18 9a9 9 0 0 1-9 9' }),
  ))
}
export function FiArrowUp(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('line', { x1: '12', y1: '19', x2: '12', y2: '5' }),
    React.createElement('polyline', { points: '5 12 12 5 19 12' }),
  ))
}
export function FiArrowDown(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('line', { x1: '12', y1: '5', x2: '12', y2: '19' }),
    React.createElement('polyline', { points: '19 12 12 19 5 12' }),
  ))
}
export function FiCheck(p: IconProps) {
  return base(p, React.createElement('polyline', { points: '20 6 9 17 4 12' }))
}
export function FiPlay(p: IconProps) {
  return base(p, React.createElement('polygon', { points: '5 3 19 12 5 21 5 3' }))
}
export function FiEdit2(p: IconProps) {
  return base(p, React.createElement('path', { d: 'M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z' }))
}
export function FiEdit3(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('path', { d: 'M12 20h9' }),
    React.createElement('path', { d: 'M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z' }),
  ))
}
export function FiTrash2(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('polyline', { points: '3 6 5 6 21 6' }),
    React.createElement('path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }),
    React.createElement('line', { x1: '10', y1: '11', x2: '10', y2: '17' }),
    React.createElement('line', { x1: '14', y1: '11', x2: '14', y2: '17' }),
  ))
}
export function FiX(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('line', { x1: '18', y1: '6', x2: '6', y2: '18' }),
    React.createElement('line', { x1: '6', y1: '6', x2: '18', y2: '18' }),
  ))
}
export function FiMenu(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('line', { x1: '3', y1: '12', x2: '21', y2: '12' }),
    React.createElement('line', { x1: '3', y1: '6', x2: '21', y2: '6' }),
    React.createElement('line', { x1: '3', y1: '18', x2: '21', y2: '18' }),
  ))
}
export function FiEye(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' }),
    React.createElement('circle', { cx: '12', cy: '12', r: '3' }),
  ))
}
export function FiCode(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('polyline', { points: '16 18 22 12 16 6' }),
    React.createElement('polyline', { points: '8 6 2 12 8 18' }),
  ))
}
export function FiSave(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('path', { d: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z' }),
    React.createElement('polyline', { points: '17 21 17 13 7 13 7 21' }),
    React.createElement('polyline', { points: '7 3 7 8 15 8' }),
  ))
}
export function FiCornerDownLeft(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('polyline', { points: '9 10 4 15 9 20' }),
    React.createElement('path', { d: 'M20 4v7a4 4 0 0 1-4 4H4' }),
  ))
}
export function FiXCircle(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('circle', { cx: '12', cy: '12', r: '10' }),
    React.createElement('line', { x1: '15', y1: '9', x2: '9', y2: '15' }),
    React.createElement('line', { x1: '9', y1: '9', x2: '15', y2: '15' }),
  ))
}
export function FiActivity(p: IconProps) {
  return base(p, React.createElement('polyline', { points: '22 12 18 12 15 21 9 3 6 12 2 12' }))
}
export function FiServer(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('rect', { x: '2', y: '2', width: '20', height: '8', rx: '2', ry: '2' }),
    React.createElement('rect', { x: '2', y: '14', width: '20', height: '8', rx: '2', ry: '2' }),
    React.createElement('line', { x1: '6', y1: '6', x2: '6.01', y2: '6' }),
    React.createElement('line', { x1: '6', y1: '18', x2: '6.01', y2: '18' }),
  ))
}
export function FiSettings(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('circle', { cx: '12', cy: '12', r: '3' }),
    React.createElement('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z' }),
  ))
}
export function FiHardDrive(p: IconProps) {
  return base(p, React.createElement(React.Fragment, null,
    React.createElement('line', { x1: '22', y1: '12', x2: '2', y2: '12' }),
    React.createElement('path', { d: 'M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' }),
    React.createElement('line', { x1: '6', y1: '16', x2: '6.01', y2: '16' }),
    React.createElement('line', { x1: '10', y1: '16', x2: '10.01', y2: '16' }),
  ))
}
export function FiSquare(p: IconProps) {
  return base(p, React.createElement('rect', { x: '3', y: '3', width: '18', height: '18', rx: '2', ry: '2' }))
}
