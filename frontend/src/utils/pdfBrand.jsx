/**
 * Shared Azure Infra IQ brand mark for all PDF exports.
 *
 * Faithful @react-pdf/renderer reproduction of /branding/logo-mark.svg — a blue
 * tile with three ascending bars, a teal growth-trend line and a node — so every
 * exported document (estate overview, project assessment, AI analysis, FinOps,
 * artifacts) shares ONE visual identity with the web portal.
 */
import React from 'react'
import { Svg, Rect, Path, Circle, Defs, LinearGradient, Stop } from '@react-pdf/renderer'

export function BrandMark({ size = 44 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Defs>
        <LinearGradient id="aiqBrandTile" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#1583E6" />
          <Stop offset="0.55" stopColor="#0A66C2" />
          <Stop offset="1" stopColor="#0E3F73" />
        </LinearGradient>
      </Defs>
      {/* Tile */}
      <Rect x="4" y="4" width="112" height="112" rx="28" fill="url(#aiqBrandTile)" />
      {/* Ascending bars */}
      <Rect x="31" y="64" width="13" height="24" rx="4" fill="#FFFFFF" fillOpacity="0.55" />
      <Rect x="53" y="50" width="13" height="38" rx="4" fill="#FFFFFF" fillOpacity="0.78" />
      <Rect x="75" y="38" width="13" height="50" rx="4" fill="#FFFFFF" />
      {/* Growth trend line + node */}
      <Path d="M37.5 60 L59.5 46 L81.5 30" stroke="#2FD3E6" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Circle cx="81.5" cy="30" r="7" fill="#0E3F73" stroke="#2FD3E6" strokeWidth="4.5" />
    </Svg>
  )
}

export default BrandMark
