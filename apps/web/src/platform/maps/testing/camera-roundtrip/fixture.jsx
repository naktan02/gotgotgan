import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapLibrePlaceMap } from '../../maplibre/MapLibrePlaceMap'
import { ExternalDirectionActions } from '../../external-links/directions/ExternalDirectionActions'

function DirectionsFixture() {
  const [destination, setDestination] = useState({ name: '서울숲', location: { latitude: 37.5444, longitude: 127.0374 } })
  window.directionFixture = { setDestination }
  return <div style={{ padding: 20 }}><button>앞 항목</button><ExternalDirectionActions destination={destination} /><button>뒤 항목</button></div>
}

function Fixture() {
  const [viewport, setViewport] = useState({
    bounds: { west: 120, east: 130, south: 30, north: 40 }, zoom: 1,
  })
  window.cameraFixture = { navigate: setViewport, viewport }
  return <MapLibrePlaceMap {...viewport} markers={[]} onSelect={() => {}}
    onViewportChange={(next) => {
      const map = window.fixtureMap
      window.lastReportedCamera = { center: map.getCenter().toArray(), zoom: map.getZoom() }
      window.viewportReports = (window.viewportReports ?? 0) + 1
      setViewport(next)
    }} />
}

createRoot(document.getElementById('root')).render(location.pathname === '/directions' ? <DirectionsFixture /> : <Fixture />)
