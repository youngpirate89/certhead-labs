import type { Lab } from '@/engine/types';
import { lab01InterfaceIp } from './ccna/lab-01-interface-ip';
import { lab02NetworkDiscovery } from './ccna/lab-02-network-discovery';
import { lab03Ipv4SubnettingRoutedInterfaces } from './ccna/lab-03-ipv4-subnetting-routed-interfaces';
import { lab04StaticRouteFundamentals } from './ccna/lab-04-static-route-fundamentals';
import { lab05OspfSingleArea } from './ccna/lab-05-ospf-single-area';
import { lab07VlanAccessPorts } from './ccna/lab-07-vlan-access-ports';
import { lab08VlanTrunking } from './ccna/lab-08-vlan-trunking';
import { lab09IntervlanRouting } from './ccna/lab-09-intervlan-routing';
import { lab10Dhcp } from './ccna/lab-10-dhcp';
import { lab15DefaultStaticRoute } from './ccna/lab-15-default-static-route';

export const FREE_CCNA_STARTER_LAB_IDS = [
  'ccna-starter-01-interface-ip',
  'ccna-starter-02-network-discovery',
  'ccna-starter-03-subnetting-routed-interfaces',
  'ccna-starter-04-static-route',
  'ccna-starter-05-ospf-neighbor',
  'ccna-starter-06-vlan-access-port',
  'ccna-starter-07-vlan-trunk',
  'ccna-starter-08-intervlan-routing',
  'ccna-starter-09-dhcp-server',
  'ccna-starter-10-default-route',
] as const;

export const FREE_CCNA_STARTER_SOURCE_LAB_IDS = [
  'ccna-l01-interface-ip',
  'ccna-lab02-network-discovery',
  'ccna-lab03-ipv4-subnetting-routed-interfaces',
  'ccna-lab04-static-route-fundamentals',
  'ccna-lab05-ospf-single-area',
  'ccna-lab07-vlan-access-ports',
  'ccna-lab08-vlan-trunking',
  'ccna-lab09-intervlan-routing',
  'ccna-lab10-dhcp-server',
  'ccna-lab15-default-static-route',
] as const;

interface StarterLabDefinition {
  readonly source: Lab;
  readonly id: (typeof FREE_CCNA_STARTER_LAB_IDS)[number];
  readonly title: string;
  readonly scenario: string;
  readonly estimatedMinutes: number;
}

function makeStarterLab(definition: StarterLabDefinition): Lab {
  return {
    ...definition.source,
    id: definition.id,
    title: definition.title,
    isFree: true,
    estimatedMinutes: definition.estimatedMinutes,
    scenario: definition.scenario,
  };
}

const STARTER_DEFINITIONS: readonly StarterLabDefinition[] = [
  {
    source: lab01InterfaceIp,
    id: 'ccna-starter-01-interface-ip',
    title: 'Starter 1: Configure an Interface IP',
    estimatedMinutes: 5,
    scenario:
      'Start with the most basic hands-on CCNA task: put an IPv4 address on a router interface, bring the link up, and verify the result. This starter version keeps the topology small so you can focus on the command sequence and the up/up evidence.',
  },
  {
    source: lab02NetworkDiscovery,
    id: 'ccna-starter-02-network-discovery',
    title: 'Starter 2: Read Network Discovery Evidence',
    estimatedMinutes: 6,
    scenario:
      'Practice the first troubleshooting habit: collect evidence before changing anything. Use router, switch, and PC commands to identify interfaces, VLANs, routes, and reachability in a small working network.',
  },
  {
    source: lab03Ipv4SubnettingRoutedInterfaces,
    id: 'ccna-starter-03-subnetting-routed-interfaces',
    title: 'Starter 3: Address Routed Interfaces',
    estimatedMinutes: 8,
    scenario:
      'Configure routed interfaces using the subnet information provided in the ticket. The starter version focuses on matching addresses and masks to the correct side of the topology before moving into larger routing labs.',
  },
  {
    source: lab04StaticRouteFundamentals,
    id: 'ccna-starter-04-static-route',
    title: 'Starter 4: Add a Basic Static Route',
    estimatedMinutes: 8,
    scenario:
      'Two small LANs are addressed, but they cannot reach each other yet. Add the required static routes, verify the routing table, and prove end-to-end reachability with a ping.',
  },
  {
    source: lab05OspfSingleArea,
    id: 'ccna-starter-05-ospf-neighbor',
    title: 'Starter 5: Form a Single-Area OSPF Neighbor',
    estimatedMinutes: 8,
    scenario:
      'Introduce dynamic routing with one focused OSPF task. Configure the branch and HQ routers into the same area, then verify that the neighbor relationship forms before continuing.',
  },
  {
    source: lab07VlanAccessPorts,
    id: 'ccna-starter-06-vlan-access-port',
    title: 'Starter 6: Place a Port in the Right VLAN',
    estimatedMinutes: 7,
    scenario:
      'A user port needs to be assigned to the correct access VLAN. Practice reading switch evidence, applying the access-port configuration, and confirming the VLAN membership.',
  },
  {
    source: lab08VlanTrunking,
    id: 'ccna-starter-07-vlan-trunk',
    title: 'Starter 7: Allow a VLAN Across a Trunk',
    estimatedMinutes: 8,
    scenario:
      'A VLAN exists, but it still has to cross the inter-switch trunk. Configure the trunk behavior and verify that the VLAN is permitted across the link.',
  },
  {
    source: lab09IntervlanRouting,
    id: 'ccna-starter-08-intervlan-routing',
    title: 'Starter 8: Route Between VLANs',
    estimatedMinutes: 9,
    scenario:
      'Move from switching into routing between VLANs. Configure router-on-a-stick basics, keep the VLAN gateways straight, and verify that hosts in separate VLANs can communicate.',
  },
  {
    source: lab10Dhcp,
    id: 'ccna-starter-09-dhcp-server',
    title: 'Starter 9: Configure DHCP for a Client VLAN',
    estimatedMinutes: 8,
    scenario:
      'A client should receive its IPv4 settings automatically. Build the DHCP pool, exclude the gateway address, and verify that the workstation receives a usable lease.',
  },
  {
    source: lab15DefaultStaticRoute,
    id: 'ccna-starter-10-default-route',
    title: 'Starter 10: Add a Default Route',
    estimatedMinutes: 7,
    scenario:
      'Finish the starter path with a gateway-of-last-resort task. Add a default static route, verify the route table, and prepare for the deeper paid CCNA troubleshooting track.',
  },
];

const FREE_CCNA_STARTER_LABS: readonly Lab[] = STARTER_DEFINITIONS.map(makeStarterLab);
const FREE_BY_ID: ReadonlyMap<string, Lab> = new Map(FREE_CCNA_STARTER_LABS.map((lab) => [lab.id, lab]));

export function getFreeCcnaStarterLabs(): readonly Lab[] {
  return FREE_CCNA_STARTER_LABS;
}

export function getFreeCcnaStarterLabById(id: string): Lab | null {
  return FREE_BY_ID.get(id) ?? null;
}
