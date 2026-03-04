/**
 * Simulation Scenarios for Field Incident Dashboard
 * 
 * Each scenario contains time-stepped updates that simulate
 * an evolving emergency situation.
 */

export const SCENARIOS = {
    FIRE: [
        // Step 1: Initial Fire Report - Units en route
        {
            incidentLocation: { lat: 31.77, lng: 35.22, name: 'Warehouse District - 1200 Sector Road' },
            timeline: [
                {
                    title: 'Warehouse Fire Reported',
                    description: 'Multiple 911 calls reporting large fire at industrial warehouse complex, 1200 Sector Road',
                    event_type: 'INCIDENT_REPORTED',
                    severity: 'HIGH',
                    created_at: new Date().toISOString(),
                },
            ],
            sectors: [
                {
                    name: 'Fire Sector Alpha',
                    status: 'ACTIVE',
                    hazard_level: 'CRITICAL',
                    hazard_description: 'Active fire spreading rapidly, chemical storage nearby',
                    center_lat: 31.77,
                    center_lng: 35.22,
                    units_deployed: 8,
                    personnel_count: 24,
                },
            ],
            units: [
                {
                    id: 'ft-001',
                    type: 'FIRE_TRUCK',
                    name: 'Fire Truck 001',
                    position: [31.80, 35.25],
                    status: 'MOVING',
                    icon: '🚒',
                    color: '#ef4444',
                },
                {
                    id: 'ft-002',
                    type: 'FIRE_TRUCK',
                    name: 'Fire Truck 002',
                    position: [31.82, 35.20],
                    status: 'MOVING',
                    icon: '🚒',
                    color: '#ef4444',
                },
                {
                    id: 'ems-001',
                    type: 'EMS',
                    name: 'Ambulance 001',
                    position: [31.75, 35.28],
                    status: 'MOVING',
                    icon: '🚑',
                    color: '#10b981',
                },
            ],
            tasks: [
                {
                    title: 'Establish Fire Command Post',
                    description: 'Set up incident command structure',
                    category: 'OPERATIONS',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 30,
                    assigned_units: 2,
                },
            ],
            stats: {
                estimated_casualties: 12,
                confirmed_deaths: 0,
                displaced_persons: 45,
            },
        },
        // Step 2: Fire Escalation - Units arriving
        {
            incidentLocation: { lat: 31.77, lng: 35.22, name: 'Warehouse District - 1200 Sector Road' },
            timeline: [
                {
                    title: 'Fire Escalating - Level 3 Response',
                    description: 'Fire has spread to adjacent buildings. Requesting additional units and evacuation of surrounding blocks',
                    event_type: 'SITUATION_UPDATE',
                    severity: 'CRITICAL',
                    created_at: new Date().toISOString(),
                },
            ],
            sectors: [
                {
                    name: 'Fire Sector Bravo',
                    status: 'ACTIVE',
                    hazard_level: 'HIGH',
                    hazard_description: 'Secondary fire in adjacent building, evacuating residents',
                    center_lat: 31.77,
                    center_lng: 35.22,
                    units_deployed: 6,
                    personnel_count: 18,
                },
            ],
            units: [
                {
                    id: 'ft-001',
                    type: 'FIRE_TRUCK',
                    name: 'Fire Truck 001',
                    position: [31.7875, 35.215],
                    status: 'ON_SCENE',
                    icon: '🚒',
                    color: '#ef4444',
                },
                {
                    id: 'ft-002',
                    type: 'FIRE_TRUCK',
                    name: 'Fire Truck 002',
                    position: [31.765, 35.22],
                    status: 'ON_SCENE',
                    icon: '🚒',
                    color: '#ef4444',
                },
                {
                    id: 'ems-001',
                    type: 'EMS',
                    name: 'Ambulance 001',
                    position: [31.77, 35.225],
                    status: 'ON_SCENE',
                    icon: '🚑',
                    color: '#10b981',
                },
            ],
            tasks: [
                {
                    title: 'Evacuate 5-Block Radius',
                    description: 'Door-to-door evacuation, priority elderly and disabled residents',
                    category: 'EVACUATION',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 45,
                    assigned_units: 8,
                },
                {
                    title: 'Water Supply Coordination',
                    description: 'Secure additional water tankers and hydrant access',
                    category: 'LOGISTICS',
                    priority: 'HIGH',
                    status: 'IN_PROGRESS',
                    progress_percent: 60,
                    assigned_units: 3,
                },
            ],
            stats: {
                estimated_casualties: 28,
                confirmed_deaths: 2,
                displaced_persons: 340,
            },
        },
        // Step 3: Chemical Hazard - Units at scene
        {
            incidentLocation: { lat: 31.77, lng: 35.22, name: 'Warehouse District - 1200 Sector Road' },
            timeline: [
                {
                    title: 'HAZMAT Alert - Chemical Storage Compromised',
                    description: 'Fire has reached chemical storage area. HAZMAT team deployed. Expanding evacuation zone to 1 mile radius',
                    event_type: 'HAZMAT_ALERT',
                    severity: 'CRITICAL',
                    created_at: new Date().toISOString(),
                },
            ],
            sectors: [
                {
                    name: 'HAZMAT Sector Charlie',
                    status: 'ACTIVE',
                    hazard_level: 'CRITICAL',
                    hazard_description: 'Toxic smoke and potential chemical release, wind carrying southeast',
                    center_lat: 31.77,
                    center_lng: 35.22,
                    units_deployed: 4,
                    personnel_count: 12,
                },
            ],
            units: [
                {
                    id: 'ft-001',
                    type: 'FIRE_TRUCK',
                    name: 'Fire Truck 001',
                    position: [31.77, 35.22],
                    status: 'ON_SCENE',
                    icon: '🚒',
                    color: '#ef4444',
                },
                {
                    id: 'ft-002',
                    type: 'FIRE_TRUCK',
                    name: 'Fire Truck 002',
                    position: [31.77, 35.22],
                    status: 'ON_SCENE',
                    icon: '🚒',
                    color: '#ef4444',
                },
                {
                    id: 'hazmat-001',
                    type: 'HAZMAT',
                    name: 'HAZMAT Unit 001',
                    position: [31.772, 35.218],
                    status: 'ON_SCENE',
                    icon: '⚠️',
                    color: '#8b5cf6',
                },
                {
                    id: 'ems-001',
                    type: 'EMS',
                    name: 'Ambulance 001',
                    position: [31.768, 35.222],
                    status: 'ON_SCENE',
                    icon: '🚑',
                    color: '#10b981',
                },
            ],
            tasks: [
                {
                    title: 'HAZMAT Containment',
                    description: 'Establish containment perimeter and deploy decontamination stations',
                    category: 'HAZMAT',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 25,
                    assigned_units: 4,
                },
                {
                    title: 'Medical Triage Setup',
                    description: 'Establish field hospital for smoke inhalation and chemical exposure cases',
                    category: 'MEDICAL',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 70,
                    assigned_units: 6,
                },
            ],
            stats: {
                estimated_casualties: 67,
                confirmed_deaths: 3,
                displaced_persons: 1240,
            },
        },
        // Step 4: Fire Under Control
        {
            incidentLocation: { lat: 31.77, lng: 35.22, name: 'Warehouse District - 1200 Sector Road' },
            timeline: [
                {
                    title: 'Fire 60% Contained',
                    description: 'Primary fire suppressed. Hot spots remain. HAZMAT team neutralizing chemical spill. Maintaining evacuation zone',
                    event_type: 'SITUATION_UPDATE',
                    severity: 'MEDIUM',
                    created_at: new Date().toISOString(),
                },
            ],
            sectors: [],
            units: [
                {
                    id: 'ft-001',
                    type: 'FIRE_TRUCK',
                    name: 'Fire Truck 001',
                    position: [31.77, 35.22],
                    status: 'ON_SCENE',
                    icon: '🚒',
                    color: '#ef4444',
                },
                {
                    id: 'hazmat-001',
                    type: 'HAZMAT',
                    name: 'HAZMAT Unit 001',
                    position: [31.772, 35.218],
                    status: 'ON_SCENE',
                    icon: '⚠️',
                    color: '#8b5cf6',
                },
            ],
            tasks: [
                {
                    title: 'Shelter Coordination',
                    description: 'Coordinate temporary housing for 1200+ displaced residents',
                    category: 'LOGISTICS',
                    priority: 'HIGH',
                    status: 'IN_PROGRESS',
                    progress_percent: 55,
                    assigned_units: 5,
                },
            ],
            stats: {
                estimated_casualties: 89,
                confirmed_deaths: 5,
                displaced_persons: 1450,
            },
        },
    ],

    TSUNAMI: [
        // Step 1: Earthquake and Tsunami Warning
        {
            timeline: [
                {
                    title: 'Offshore Earthquake 7.8 Magnitude',
                    description: 'Major earthquake detected 80km offshore. Tsunami Warning issued for entire coastal region. Estimated wave arrival: 25 minutes',
                    event_type: 'NATURAL_DISASTER',
                    severity: 'CRITICAL',
                    created_at: new Date().toISOString(),
                },
            ],
            sectors: [
                {
                    name: 'Coastal Sector 1 (North)',
                    status: 'ACTIVE',
                    hazard_level: 'CRITICAL',
                    hazard_description: 'Direct tsunami impact zone - immediate evacuation required',
                    units_deployed: 15,
                    personnel_count: 45,
                },
            ],
            tasks: [
                {
                    title: 'Mass Coastal Evacuation',
                    description: 'Evacuate all residents within 2km of coastline to high ground',
                    category: 'EVACUATION',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 20,
                    assigned_units: 25,
                },
                {
                    title: 'Emergency Broadcast Activation',
                    description: 'Activate all emergency alert systems - sirens, mobile alerts, radio',
                    category: 'COMMUNICATIONS',
                    priority: 'CRITICAL',
                    status: 'COMPLETED',
                    progress_percent: 100,
                    assigned_units: 2,
                },
            ],
            stats: {
                estimated_casualties: 0,
                confirmed_deaths: 0,
                displaced_persons: 0,
            },
        },
        // Step 2: Tsunami Impact
        {
            timeline: [
                {
                    title: 'Tsunami Wave Impact - 8 Meter Wave',
                    description: 'First tsunami wave has struck coastline. Extensive flooding in coastal zones. Multiple buildings collapsed. Search and rescue operations beginning',
                    event_type: 'SITUATION_UPDATE',
                    severity: 'CRITICAL',
                    created_at: new Date().toISOString(),
                },
            ],
            sectors: [
                {
                    name: 'Coastal Sector 2 (South)',
                    status: 'ACTIVE',
                    hazard_level: 'CRITICAL',
                    hazard_description: 'Severe flooding, structural damage, secondary waves expected',
                    units_deployed: 18,
                    personnel_count: 54,
                },
                {
                    name: 'Inland Sector Delta',
                    status: 'ACTIVE',
                    hazard_level: 'MEDIUM',
                    hazard_description: 'Temporary shelter zone - receiving evacuees',
                    units_deployed: 8,
                    personnel_count: 24,
                },
            ],
            tasks: [
                {
                    title: 'Urban Search and Rescue',
                    description: 'Deploy USAR teams to collapsed structures. Prioritize areas with known occupants',
                    category: 'SEARCH_RESCUE',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 15,
                    assigned_units: 12,
                },
                {
                    title: 'Swift Water Rescue Operations',
                    description: 'Rescue individuals trapped in flooded areas and vehicles',
                    category: 'SEARCH_RESCUE',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 30,
                    assigned_units: 8,
                },
            ],
            stats: {
                estimated_casualties: 340,
                confirmed_deaths: 45,
                displaced_persons: 8900,
            },
        },
        // Step 3: Secondary Wave and Infrastructure Damage
        {
            timeline: [
                {
                    title: 'Second Tsunami Wave - Infrastructure Critical',
                    description: 'Second wave 6m high struck coast. Hospital flooded and being evacuated. Power grid failure across coastal region. Water treatment plant compromised',
                    event_type: 'INFRASTRUCTURE_FAILURE',
                    severity: 'CRITICAL',
                    created_at: new Date().toISOString(),
                },
            ],
            sectors: [
                {
                    name: 'Medical Emergency Sector',
                    status: 'ACTIVE',
                    hazard_level: 'CRITICAL',
                    hazard_description: 'Coastal hospital evacuation in progress - 200 patients including ICU',
                    units_deployed: 10,
                    personnel_count: 30,
                },
            ],
            tasks: [
                {
                    title: 'Hospital Patient Evacuation',
                    description: 'Emergency evacuation of all hospital patients to inland facilities',
                    category: 'MEDICAL',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 55,
                    assigned_units: 15,
                },
                {
                    title: 'Water Contamination Alert',
                    description: 'Issue boil water notices. Deploy emergency water distribution',
                    category: 'PUBLIC_HEALTH',
                    priority: 'HIGH',
                    status: 'IN_PROGRESS',
                    progress_percent: 40,
                    assigned_units: 6,
                },
                {
                    title: 'Emergency Shelter Expansion',
                    description: 'Open additional shelters and coordinate food/medical supplies',
                    category: 'LOGISTICS',
                    priority: 'HIGH',
                    status: 'IN_PROGRESS',
                    progress_percent: 65,
                    assigned_units: 12,
                },
            ],
            stats: {
                estimated_casualties: 890,
                confirmed_deaths: 124,
                displaced_persons: 24500,
            },
        },
        // Step 4: Recovery Phase
        {
            timeline: [
                {
                    title: 'Tsunami Warning Lifted - Recovery Phase',
                    description: 'No further tsunami waves expected. Beginning damage assessment and recovery operations. Multiple areas still inaccessible due to flooding',
                    event_type: 'SITUATION_UPDATE',
                    severity: 'HIGH',
                    created_at: new Date().toISOString(),
                },
            ],
            sectors: [],
            tasks: [
                {
                    title: 'Structural Assessment Teams',
                    description: 'Engineer teams assessing building safety before reentry',
                    category: 'OPERATIONS',
                    priority: 'HIGH',
                    status: 'IN_PROGRESS',
                    progress_percent: 20,
                    assigned_units: 8,
                },
            ],
            stats: {
                estimated_casualties: 1240,
                confirmed_deaths: 187,
                displaced_persons: 31000,
            },
        },
    ],

    EARTHQUAKE: [
        // Step 1: Initial Earthquake
        {
            timeline: [
                {
                    title: 'Major Earthquake - 6.9 Magnitude',
                    description: 'Severe earthquake struck city center. Multiple buildings damaged. Power outages widespread. Phone networks congested',
                    event_type: 'NATURAL_DISASTER',
                    severity: 'CRITICAL',
                    created_at: new Date().toISOString(),
                },
            ],
            sectors: [
                {
                    name: 'Downtown Sector Alpha',
                    status: 'ACTIVE',
                    hazard_level: 'CRITICAL',
                    hazard_description: 'Multiple structural collapses, gas leaks reported, aftershocks expected',
                    units_deployed: 20,
                    personnel_count: 60,
                },
            ],
            tasks: [
                {
                    title: 'Building Collapse Response',
                    description: 'Deploy USAR teams to 8 collapsed structures in downtown area',
                    category: 'SEARCH_RESCUE',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 10,
                    assigned_units: 16,
                },
                {
                    title: 'Gas Leak Control',
                    description: 'Coordinate with utility company to shut off gas mains in affected areas',
                    category: 'HAZMAT',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 35,
                    assigned_units: 6,
                },
            ],
            stats: {
                estimated_casualties: 450,
                confirmed_deaths: 28,
                displaced_persons: 3400,
            },
        },
        // Step 2: Aftershock and Fire Outbreak
        {
            timeline: [
                {
                    title: 'Major Aftershock 5.4 - Multiple Fires',
                    description: 'Strong aftershock caused additional damage. Gas line ruptures triggered fires in 3 locations. Partial dam failure upstream - flood risk',
                    event_type: 'SITUATION_UPDATE',
                    severity: 'CRITICAL',
                    created_at: new Date().toISOString(),
                },
            ],
            sectors: [
                {
                    name: 'Fire Sector Bravo',
                    status: 'ACTIVE',
                    hazard_level: 'CRITICAL',
                    hazard_description: 'Gas-fed fires in multiple locations, limited water pressure',
                    units_deployed: 14,
                    personnel_count: 42,
                },
                {
                    name: 'Flood Risk Sector Charlie',
                    status: 'ACTIVE',
                    hazard_level: 'HIGH',
                    hazard_description: 'Dam structural damage - potential flooding of low-lying areas',
                    units_deployed: 8,
                    personnel_count: 24,
                },
            ],
            tasks: [
                {
                    title: 'Fire Suppression - Multiple Locations',
                    description: 'Coordinate firefighting across 3 active fire zones with limited water',
                    category: 'OPERATIONS',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 25,
                    assigned_units: 14,
                },
                {
                    title: 'Downstream Evacuation',
                    description: 'Evacuate residents downstream of damaged dam',
                    category: 'EVACUATION',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 50,
                    assigned_units: 10,
                },
                {
                    title: 'Medical Field Operations',
                    description: 'Establish field hospitals - local hospitals at capacity',
                    category: 'MEDICAL',
                    priority: 'HIGH',
                    status: 'IN_PROGRESS',
                    progress_percent: 60,
                    assigned_units: 8,
                },
            ],
            stats: {
                estimated_casualties: 890,
                confirmed_deaths: 67,
                displaced_persons: 12400,
            },
        },
        // Step 3: Infrastructure Crisis
        {
            timeline: [
                {
                    title: 'Critical Infrastructure Failures',
                    description: 'Major bridge collapse isolating east side. Hospital generators failing. Water treatment offline. Communications towers damaged',
                    event_type: 'INFRASTRUCTURE_FAILURE',
                    severity: 'CRITICAL',
                    created_at: new Date().toISOString(),
                },
            ],
            sectors: [
                {
                    name: 'Isolated East Sector',
                    status: 'ACTIVE',
                    hazard_level: 'HIGH',
                    hazard_description: 'Bridge collapse - area isolated, helicopter access only',
                    units_deployed: 4,
                    personnel_count: 12,
                },
            ],
            tasks: [
                {
                    title: 'Emergency Bridge Access',
                    description: 'Deploy temporary bridge and helicopter evacuations for critically injured',
                    category: 'LOGISTICS',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 30,
                    assigned_units: 8,
                },
                {
                    title: 'Hospital Power Restoration',
                    description: 'Emergency generator repair and fuel resupply to all hospitals',
                    category: 'LOGISTICS',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 70,
                    assigned_units: 4,
                },
                {
                    title: 'Emergency Communications Network',
                    description: 'Deploy mobile cell towers and satellite communication equipment',
                    category: 'COMMUNICATIONS',
                    priority: 'HIGH',
                    status: 'IN_PROGRESS',
                    progress_percent: 45,
                    assigned_units: 3,
                },
            ],
            stats: {
                estimated_casualties: 1450,
                confirmed_deaths: 134,
                displaced_persons: 28000,
            },
        },
        // Step 4: Stabilization
        {
            timeline: [
                {
                    title: 'Situation Stabilizing',
                    description: 'No major aftershocks in 6 hours. Fires contained. Power being restored sector by sector. Ongoing search and rescue operations',
                    event_type: 'SITUATION_UPDATE',
                    severity: 'MEDIUM',
                    created_at: new Date().toISOString(),
                },
            ],
            sectors: [],
            tasks: [
                {
                    title: 'Ongoing Rescue Operations',
                    description: 'Continue search operations in collapsed structures',
                    category: 'SEARCH_RESCUE',
                    priority: 'HIGH',
                    status: 'IN_PROGRESS',
                    progress_percent: 75,
                    assigned_units: 12,
                },
            ],
            stats: {
                estimated_casualties: 1680,
                confirmed_deaths: 189,
                displaced_persons: 34000,
            },
        },
    ],

    MISSILE: [
        // Step 1: Missile Alert
        {
            timeline: [
                {
                    title: 'MISSILE ALERT - INCOMING THREAT',
                    description: 'Multiple ballistic missiles detected inbound. Estimated impact: 4 minutes. TAKE COVER IMMEDIATELY. Alert sirens activated citywide',
                    event_type: 'SECURITY_THREAT',
                    severity: 'CRITICAL',
                    created_at: new Date().toISOString(),
                },
            ],
            sectors: [
                {
                    name: 'City Defense Sector',
                    status: 'ACTIVE',
                    hazard_level: 'CRITICAL',
                    hazard_description: 'Ballistic missile threat - all personnel to shelters',
                    units_deployed: 5,
                    personnel_count: 15,
                },
            ],
            tasks: [
                {
                    title: 'Emergency Alert Broadcast',
                    description: 'Activate all warning systems - sirens, mobile alerts, TV/radio emergency broadcast',
                    category: 'COMMUNICATIONS',
                    priority: 'CRITICAL',
                    status: 'COMPLETED',
                    progress_percent: 100,
                    assigned_units: 2,
                },
                {
                    title: 'Shelter-in-Place Protocol',
                    description: 'Direct all residents to nearest bomb shelters or interior rooms',
                    category: 'EVACUATION',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 60,
                    assigned_units: 8,
                },
            ],
            stats: {
                estimated_casualties: 0,
                confirmed_deaths: 0,
                displaced_persons: 0,
            },
        },
        // Step 2: Impact
        {
            timeline: [
                {
                    title: 'MULTIPLE IMPACTS CONFIRMED',
                    description: 'Three missiles struck city. Impact zones: Industrial sector, residential area, near hospital. Extensive damage and fires. Mass casualty event in progress',
                    event_type: 'MASS_CASUALTY',
                    severity: 'CRITICAL',
                    created_at: new Date().toISOString(),
                },
            ],
            sectors: [
                {
                    name: 'Impact Zone Alpha (Industrial)',
                    status: 'ACTIVE',
                    hazard_level: 'CRITICAL',
                    hazard_description: 'Direct missile impact - large fires, structural collapse, chemical storage compromised',
                    units_deployed: 12,
                    personnel_count: 36,
                },
                {
                    name: 'Impact Zone Bravo (Residential)',
                    status: 'ACTIVE',
                    hazard_level: 'CRITICAL',
                    hazard_description: 'Apartment complex destroyed - mass casualties, ongoing collapse risk',
                    units_deployed: 18,
                    personnel_count: 54,
                },
            ],
            tasks: [
                {
                    title: 'Mass Casualty Triage',
                    description: 'Establish multiple triage points. Prioritize critical patients for immediate evacuation',
                    category: 'MEDICAL',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 35,
                    assigned_units: 20,
                },
                {
                    title: 'Urban Search and Rescue',
                    description: 'Deploy all available USAR teams to collapsed structures',
                    category: 'SEARCH_RESCUE',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 20,
                    assigned_units: 15,
                },
                {
                    title: 'Industrial Fire Control',
                    description: 'Contain fires in industrial zone - chemical hazards present',
                    category: 'HAZMAT',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 15,
                    assigned_units: 10,
                },
            ],
            stats: {
                estimated_casualties: 780,
                confirmed_deaths: 156,
                displaced_persons: 4500,
            },
        },
        // Step 3: Secondary Threats
        {
            timeline: [
                {
                    title: 'Secondary Alert - Unexploded Ordnance',
                    description: 'UXO (unexploded ordnance) discovered in Impact Zone Charlie. EOD teams deployed. Expanding evacuation perimeter. Hospital evacuations ongoing due to structural damage',
                    event_type: 'HAZMAT_ALERT',
                    severity: 'CRITICAL',
                    created_at: new Date().toISOString(),
                },
            ],
            sectors: [
                {
                    name: 'Impact Zone Charlie (Hospital District)',
                    status: 'ACTIVE',
                    hazard_level: 'CRITICAL',
                    hazard_description: 'Near-miss on hospital - structural damage, UXO in vicinity',
                    units_deployed: 14,
                    personnel_count: 42,
                },
                {
                    name: 'EOD Sector',
                    status: 'ACTIVE',
                    hazard_level: 'CRITICAL',
                    hazard_description: 'Unexploded ordnance - evacuation zone 500m radius',
                    units_deployed: 4,
                    personnel_count: 8,
                },
            ],
            tasks: [
                {
                    title: 'Hospital Emergency Evacuation',
                    description: 'Evacuate all patients from damaged hospital to alternate facilities',
                    category: 'MEDICAL',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 45,
                    assigned_units: 16,
                },
                {
                    title: 'EOD Operations - UXO Disposal',
                    description: 'Explosive ordnance disposal team securing and removing unexploded missile',
                    category: 'HAZMAT',
                    priority: 'CRITICAL',
                    status: 'IN_PROGRESS',
                    progress_percent: 25,
                    assigned_units: 4,
                },
                {
                    title: 'Mass Shelter Operations',
                    description: 'Open all emergency shelters. Coordinate with regional authorities for resources',
                    category: 'LOGISTICS',
                    priority: 'HIGH',
                    status: 'IN_PROGRESS',
                    progress_percent: 70,
                    assigned_units: 12,
                },
            ],
            stats: {
                estimated_casualties: 1340,
                confirmed_deaths: 312,
                displaced_persons: 18400,
            },
        },
        // Step 4: Recovery and Ongoing Operations
        {
            timeline: [
                {
                    title: 'UXO Neutralized - Continuing Operations',
                    description: 'Unexploded ordnance successfully neutralized. Search and rescue continuing. Fire zones contained. Federal disaster assistance activated',
                    event_type: 'SITUATION_UPDATE',
                    severity: 'HIGH',
                    created_at: new Date().toISOString(),
                },
            ],
            sectors: [],
            tasks: [
                {
                    title: 'Ongoing Victim Recovery',
                    description: 'Continue search operations in all impact zones',
                    category: 'SEARCH_RESCUE',
                    priority: 'HIGH',
                    status: 'IN_PROGRESS',
                    progress_percent: 60,
                    assigned_units: 18,
                },
                {
                    title: 'Infrastructure Assessment',
                    description: 'Damage assessment teams evaluating utilities and structures',
                    category: 'OPERATIONS',
                    priority: 'HIGH',
                    status: 'IN_PROGRESS',
                    progress_percent: 40,
                    assigned_units: 8,
                },
            ],
            stats: {
                estimated_casualties: 1890,
                confirmed_deaths: 467,
                displaced_persons: 28900,
            },
        },
    ],
};
