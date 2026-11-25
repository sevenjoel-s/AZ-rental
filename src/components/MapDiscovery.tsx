import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Listing } from '../types';

interface Props {
  listings: Listing[];
  userCoords: { lat: number; lng: number } | null;
  onSelectListing: (listing: Listing) => void;
  heightClass?: string;
}

export const MapDiscovery: React.FC<Props> = ({
  listings,
  userCoords,
  onSelectListing,
  heightClass = 'h-[480px]',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialCenter: [number, number] = userCoords
      ? [userCoords.lat, userCoords.lng]
      : [9.0054, 38.7636]; // Addis Ababa center

    const map = L.map(containerRef.current, {
      center: initialCenter,
      zoom: userCoords ? 12 : 7,
      scrollWheelZoom: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    layerGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    if (userCoords) {
      const userMarker = L.circleMarker([userCoords.lat, userCoords.lng], {
        radius: 9,
        fillColor: '#F5A623',
        color: '#123B65',
        weight: 3,
        opacity: 1,
        fillOpacity: 1,
      }).bindPopup('<strong>Your Current Location</strong>');
      group.addLayer(userMarker);
    }

    const bounds: [number, number][] = [];
    listings.forEach((item) => {
      if (typeof item.latitude !== 'number' || typeof item.longitude !== 'number') return;
      bounds.push([item.latitude, item.longitude]);
      const price = item.price_monthly || item.price_daily || item.price_weekly || item.price_hourly || 0;
      const divIcon = L.divIcon({
        className: 'az-map-pin',
        html: `<div style="background:#123B65;color:#fff;padding:4px 8px;border-radius:8px;font-weight:700;font-size:11px;white-space:nowrap;border:2px solid #F5A623;box-shadow:0 2px 8px rgba(0,0,0,0.25);">ETB ${Number(price).toLocaleString()}</div>`,
        iconSize: [90, 28],
        iconAnchor: [45, 14],
      });

      const marker = L.marker([item.latitude, item.longitude], { icon: divIcon });
      const popupNode = document.createElement('div');
      popupNode.style.minWidth = '200px';
      popupNode.innerHTML = `
        <div style="font-family: DM Sans, sans-serif;">
          <div style="font-weight:700;font-size:13px;color:#123B65;margin-bottom:4px;">${item.title.replace(/</g, '&lt;')}</div>
          <div style="font-size:11px;color:#475569;margin-bottom:6px;">${item.city}${item.sub_city ? ' · ' + item.sub_city : ''}${item.distanceKm != null ? ' · ' + item.distanceKm + ' km' : ''}</div>
          <button type="button" data-view-id="${item.id}" style="background:#F5A623;color:#123B65;border:none;padding:6px 10px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;width:100%;">View Rental</button>
        </div>
      `;
      popupNode.querySelector('button')?.addEventListener('click', () => {
        onSelectListing(item);
      });
      marker.bindPopup(popupNode);
      group.addLayer(marker);
    });

    if (userCoords) {
      map.setView([userCoords.lat, userCoords.lng], 12);
    } else if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    }
  }, [listings, userCoords, onSelectListing]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div ref={containerRef} className={`w-full ${heightClass}`} />
    </div>
  );
};
