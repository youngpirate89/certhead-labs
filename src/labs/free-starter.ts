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

const FREE_CCNA_STARTER_LABS: readonly Lab[] = [
  lab01InterfaceIp,
  lab02NetworkDiscovery,
  lab03Ipv4SubnettingRoutedInterfaces,
  lab04StaticRouteFundamentals,
  lab05OspfSingleArea,
  lab07VlanAccessPorts,
  lab08VlanTrunking,
  lab09IntervlanRouting,
  lab10Dhcp,
  lab15DefaultStaticRoute,
];

const FREE_BY_ID: ReadonlyMap<string, Lab> = new Map(FREE_CCNA_STARTER_LABS.map((lab) => [lab.id, lab]));

export function getFreeCcnaStarterLabs(): readonly Lab[] {
  return FREE_CCNA_STARTER_LABS;
}

export function getFreeCcnaStarterLabById(id: string): Lab | null {
  return FREE_BY_ID.get(id) ?? null;
}
