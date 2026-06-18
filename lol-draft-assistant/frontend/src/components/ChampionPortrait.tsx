import type { Champion } from '../types'

interface Props {
  champion: Champion | undefined
  size?: 'sm' | 'md' | 'lg'
  overlay?: string
  dimmed?: boolean
  className?: string
}

const SIZES = { sm: 'w-10 h-10', md: 'w-14 h-14', lg: 'w-20 h-20' }

export function ChampionPortrait({ champion, size = 'md', overlay, dimmed, className = '' }: Props) {
  const sz = SIZES[size]
  if (!champion) {
    return (
      <div className={`${sz} rounded bg-lol-blue-dim border border-lol-blue/20 flex items-center justify-center ${className}`}>
        <span className="text-lol-blue/40 text-xs">?</span>
      </div>
    )
  }

  return (
    <div className={`${sz} relative rounded overflow-hidden border border-lol-gold/30 ${className}`}>
      <img
        src={champion.squareImage}
        alt={champion.name}
        className={`w-full h-full object-cover ${dimmed ? 'opacity-40 grayscale' : ''}`}
        onError={(e) => { (e.target as HTMLImageElement).src = champion.image }}
      />
      {overlay && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
          <span className="text-white text-xs font-bold">{overlay}</span>
        </div>
      )}
    </div>
  )
}
