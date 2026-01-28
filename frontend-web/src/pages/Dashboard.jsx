import React, { useEffect, useState } from 'react';
import { useDashboardStore } from '../store/dashboard.js';
import { useFieldIncidentStore } from '../store/fieldIncident.js';
import { RealtimeService } from '../services/realtime.js';
import { KPICards } from '../components/KPICards.jsx';
import { FilterBar } from '../components/FilterBar.jsx';
import { IncidentList } from '../components/IncidentList.jsx';
import { MapView } from '../components/MapView.jsx';
import { IncidentDetailsPanel } from '../components/IncidentDetailsPanel.jsx';
import { EventFeed } from '../components/EventFeed.jsx';
import * as api from '../api/client.js';

/**
 * Dashboard Page - Main operational dashboard (War-Room)
 * 
 * Syncs with Field Incident Dashboard when simulation is active.
 * Displays real operational data when in routine mode.
 */
export default function Dashboard() {
  const {
    setIncidents,
    setUnits,
    setEvents,
    addIncident,
    updateIncident,
    updateUnit,
    addEvent,
    setConnectionStatus,
    connectionStatus,
    demoMode,
    lastUpdateTime,
    incidents,
  } = useDashboardStore();

  // Connect to Field Incident simulation store
  const {
    mode: fieldMode,
    simulationType,
    majorIncident,
    sectors: fieldSectors,
    events: fieldTimeline,
    taskGroups,
    units: simulationUnits,
    routineUnits,
    moveUnits,
    tickRoutinePatrol,
    setIncidents: setFieldIncidents,
  } = useFieldIncidentStore();

  const { selectedUnitIds } = useDashboardStore();

  const [isLoading, setIsLoading] = useState(true);
  const [realtimeService, setRealtimeService] = useState(null);
  const [showEventFeed, setShowEventFeed] = useState(false);
  const [activeFilter, setActiveFilter] = useState('ALL'); // Filter for incident types: 'ALL', 'FIRE', 'POLICE', 'MEDICAL'

  // Simulation override detection
  const isSimulation = fieldMode === 'SIMULATION';

  // Sync dashboard incidents to field incident store
  useEffect(() => {
    if (Array.isArray(incidents) && incidents.length > 0) {
      console.log('📍 Syncing', incidents.length, 'incidents to fieldIncident store');
      setFieldIncidents(incidents);
    }
  }, [incidents, setFieldIncidents]);

  // Sync simulation events to war-room when active
  useEffect(() => {
    if (isSimulation && fieldTimeline) {
      // Convert field timeline events to dashboard event format
      const convertedEvents = fieldTimeline.map((evt, idx) => ({
        id: evt.id || `sim-${idx}`,
        timestamp: evt.timestamp || new Date().toISOString(),
        entity_type: 'simulation',
        entity_id: majorIncident?.id || 'sim',
        message: evt.title || evt.message || 'Simulation event',
        level: evt.severity === 'CRITICAL' ? 'error' :
          evt.severity === 'HIGH' ? 'warn' : 'info',
      }));
      setEvents(convertedEvents);
    }
  }, [isSimulation, fieldTimeline, majorIncident, setEvents]);

  // Initialize data and realtime connection
  useEffect(() => {
    const initializeData = async () => {
      try {
        setConnectionStatus('CONNECTING');

        // Fetch initial data
        const [incidents, units, events] = await Promise.all([
          api.getIncidents(),
          api.getUnits(),
          api.getEvents(100),
        ]);

        setIncidents(incidents);
        setUnits(units);
        setEvents(events);

        setConnectionStatus('CONNECTED');
        setIsLoading(false);

        // Connect to realtime updates
        const realtime = new RealtimeService(
          (update) => {
            if (update.type === 'connected') {
              console.log('Connected to real-time updates');
              setConnectionStatus('CONNECTED');
            } else if (update.type === 'incident_created') {
              addIncident(update.data);
              addEvent({
                id: Math.random(),
                timestamp: new Date().toISOString(),
                entity_type: 'incident',
                entity_id: update.data.id,
                message: `New incident: ${update.data.title}`,
                level: 'warn',
              });
            } else if (update.type === 'incident_updated') {
              updateIncident(update.data.id, update.data);
              addEvent({
                id: Math.random(),
                timestamp: new Date().toISOString(),
                entity_type: 'incident',
                entity_id: update.data.id,
                message: `Incident updated`,
                level: 'info',
              });
            } else if (update.type === 'unit_updated') {
              updateUnit(update.data.id, update.data);
            }
          },
          (error) => {
            console.error('Realtime error:', error);
            setConnectionStatus('DEGRADED');
          }
        );

        realtime.connect();
        setRealtimeService(realtime);
      } catch (error) {
        console.error('Failed to initialize dashboard:', error);
        setConnectionStatus('OFFLINE');
        setIsLoading(false);
      }
    };

    initializeData();

    return () => {
      realtimeService?.disconnect();
    };
  }, []);

  // Fallback polling if realtime fails
  useEffect(() => {
    if (connectionStatus !== 'DEGRADED') return;

    const interval = setInterval(async () => {
      try {
        const incidents = await api.getIncidents();
        setIncidents(incidents);
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [connectionStatus]);

  // Unit movement loop - runs continuously to move units along their routes
  useEffect(() => {
    const movementInterval = setInterval(() => {
      const { moveUnits: latestMoveUnits, tickRoutinePatrol: latestTickPatrol, mode } = useFieldIncidentStore.getState();

      // First tick routine patrol (for patrol units)
      if (mode === 'ROUTINE' && latestTickPatrol) {
        latestTickPatrol();
      }

      // Then move units along routes (for dispatched units)
      if (latestMoveUnits) {
        latestMoveUnits();
      }
    }, 1000); // Run every second for smooth movement

    return () => clearInterval(movementInterval);
  }, []);

  const getConnectionStatusColor = () => {
    const colors = {
      CONNECTED: '#10b981',
      CONNECTING: '#f59e0b',
      DEGRADED: '#eab308',
      OFFLINE: '#ef4444',
    };
    return colors[connectionStatus] || '#6b7280';
  };

  const getConnectionStatusText = () => {
    const texts = {
      CONNECTED: '🟢 LIVE',
      CONNECTING: '🟡 CONNECTING',
      DEGRADED: '🟡 DEGRADED',
      OFFLINE: '🔴 OFFLINE',
    };
    return texts[connectionStatus] || 'UNKNOWN';
  };

  if (isLoading) {
    return (
      <div className="dashboard loading">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Initializing Dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {/* Simulation Mode Banner */}
      {isSimulation && (
        <div className="simulation-banner">
          <div className="banner-content">
            <span className="banner-icon">⚠️</span>
            <span className="banner-text">
              SIMULATION MODE ACTIVE - {simulationType || 'UNKNOWN'} SCENARIO
            </span>
            <span className="banner-badge">TRAINING EXERCISE</span>
          </div>
        </div>
      )}

      {/* Top Bar */}
      <div className="dashboard-topbar">
        <div className="topbar-left">
          <h1>🎯 Field War-Room Dashboard</h1>
        </div>
        <div className="topbar-center">
          {lastUpdateTime && (
            <small>Last update: {lastUpdateTime.toLocaleTimeString()}</small>
          )}
        </div>
        <div className="topbar-right">
          {demoMode && <span className="demo-badge">DEMO MODE</span>}
          <span
            className="connection-status"
            style={{ color: getConnectionStatusColor() }}
          >
            {getConnectionStatusText()}
          </span>
          <button
            className="feed-toggle"
            onClick={() => setShowEventFeed(!showEventFeed)}
          >
            📋 Events {showEventFeed ? '✕' : ''}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="dashboard-section">
        <KPICards
          simulationData={isSimulation && majorIncident ? {
            estimated_casualties: majorIncident.estimated_casualties,
            displaced_persons: majorIncident.displaced_persons,
            confirmed_deaths: majorIncident.confirmed_deaths,
            active_sectors: fieldSectors.filter(s => s?.status === 'ACTIVE').length,
          } : null}
        />
      </div>

      {/* Filter Bar */}
      <div className="dashboard-section">
        <FilterBar />
      </div>

      {/* Main Content Area */}
      <div className="dashboard-content">
        {/* Left: Incident List */}
        <div className="content-left">
          <IncidentList
            activeFilter={activeFilter}
            setActiveFilter={setActiveFilter}
            isSimulation={isSimulation}
            simulationEvents={isSimulation ? fieldTimeline : null}
          />
        </div>

        {/* Center: Map */}
        <div className="content-center">
          <MapView
            simulationSectors={isSimulation ? fieldSectors : null}
            activeFilter={activeFilter}
            isSimulation={isSimulation}
            simulationIncident={isSimulation && majorIncident ? {
              id: majorIncident.id || 'sim-incident',
              lat: majorIncident.location_lat || 31.77,
              lng: majorIncident.location_lng || 35.22,
              name: majorIncident.title || 'Incident Location',
              priority: majorIncident.priority || 'HIGH',
              status: majorIncident.status || 'IN_PROGRESS',
              title: majorIncident.title || 'Incident',
              location_name: majorIncident.location_name || 'Field Location'
            } : null}
            simulationUnits={isSimulation ? simulationUnits : null}
            routineUnits={!isSimulation ? routineUnits : null}
            selectedUnitIds={selectedUnitIds}
          />
        </div>

        {/* Right: Details + Events */}
        <div className="content-right">
          {showEventFeed ? (
            <EventFeed />
          ) : (
            <IncidentDetailsPanel />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="dashboard-footer">
        <small>
          Emergency CRM Field Operations Dashboard | © 2024 | Mock Data Service
        </small>
      </div>
    </div>
  );
}
