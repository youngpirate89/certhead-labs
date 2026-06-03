import type { LabSmokeCase } from './batch-d';

export const batchJTicketLabs: LabSmokeCase[] = [
  {
    id: 'ccna-tshoot-ipv6-missing-default-gateway',
    title: 'Troubleshoot: IPv6 Default Gateway Missing',
    expectedStart: '0/4',
    expectedComplete: '4/4',
    steps: [
      { device: 'PC-OPS', workbench: 'Command Prompt', commands: ['Get-NetIPConfiguration'] },
      { device: 'R1', commands: ['enable', 'show ipv6 interface brief'] },
      {
        device: 'PC-OPS',
        workbench: 'Command Prompt',
        commands: [
          'New-NetIPAddress -InterfaceAlias Eth0 -IPAddress 2001:db8:47:10::50 -PrefixLength 64 -DefaultGateway 2001:db8:47:10::1',
          'Get-NetIPConfiguration',
        ],
      },
    ],
  },
];
