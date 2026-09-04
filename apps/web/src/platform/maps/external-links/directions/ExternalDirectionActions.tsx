import styles from './external-direction-actions.module.css'
import { buildExternalDirectionLinks } from './external-direction-links'

type ExternalDirectionActionsProperties = Readonly<{
  destination: Readonly<{
    name: string
    location: Readonly<{ latitude: number; longitude: number }> | null
  }>
}>

export function ExternalDirectionActions({ destination }: ExternalDirectionActionsProperties) {
  if (destination.location === null) return null
  const links = buildExternalDirectionLinks({ name: destination.name, location: destination.location })

  return (
    <nav aria-label="외부 지도 길찾기" className={styles.links}>
      {links.map((link) => (
        <a
          href={link.href}
          key={link.provider}
          rel="external noopener noreferrer"
          target="_blank"
        >{link.label}</a>
      ))}
    </nav>
  )
}
