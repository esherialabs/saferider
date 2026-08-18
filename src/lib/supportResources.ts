export type SupportResourceSource = {
  title: string;
  url: string;
};

export type SupportContact = {
  id: string;
  label: string;
  shortLabel: string;
  displayPhone: string;
  phoneNumbers: readonly string[];
  availability: string;
  description: string;
  sources: readonly SupportResourceSource[];
};

// Kenya default support contacts. Source notes are kept here so release-facing
// screens do not drift back to US emergency copy or unsupported hotline claims.
export const KENYA_SUPPORT_RESOURCES = {
  gbvHelpline: {
    id: 'ke-gbv-1195',
    label: 'National GBV Toll-Free Helpline',
    shortLabel: 'GBV support 1195',
    displayPhone: '1195',
    phoneNumbers: ['1195'],
    availability: '24/7',
    description: 'Confidential GBV support and referral help within Kenya.',
    sources: [
      {
        title: 'Healthcare Assistance Kenya - 1195 Helpline',
        url: 'https://hakgbv1195.org/',
      },
      {
        title: 'UN Women Kenya - National toll-free helpline 1195',
        url: 'https://africa.unwomen.org/en/stories/news/2024/10/kenyas-national-toll-free-helpline-1195-a-lifeline-for-gender-based-violence-survivors',
      },
    ],
  },
  policeEmergency: {
    id: 'ke-police-999-112',
    label: 'Police and emergency services',
    shortLabel: 'Police/emergency 999 or 112',
    displayPhone: '999 / 112',
    phoneNumbers: ['999', '112'],
    availability: '24/7',
    description: 'Kenya police and emergency contact numbers.',
    sources: [
      {
        title: 'Kenya National Police Service - contact page',
        url: 'https://nationalpolice.go.ke/contact',
      },
    ],
  },
  childHelpline: {
    id: 'ke-child-116',
    label: 'National Child Helpline',
    shortLabel: 'Child Helpline 116',
    displayPhone: '116',
    phoneNumbers: ['116'],
    availability: '24/7',
    description: 'Child protection helpline in Kenya; do not label as the adult GBV helpline.',
    sources: [
      {
        title: 'Kenya State Department for Children Services - Child Helpline 116',
        url: 'https://www.childrenservices.go.ke/child-helpline-116',
      },
    ],
  },
} as const satisfies Record<string, SupportContact>;

export const PRIMARY_KENYA_GBV_CONTACT = KENYA_SUPPORT_RESOURCES.gbvHelpline;
export const KENYA_POLICE_EMERGENCY_CONTACT = KENYA_SUPPORT_RESOURCES.policeEmergency;

export function getDialUrl(phoneNumber: string, platform: string): string {
  const normalizedNumber = phoneNumber.replace(/[^\d+]/g, '');
  return platform === 'android' ? `tel:${normalizedNumber}` : `tel://${normalizedNumber}`;
}

export const KENYA_IMMEDIATE_HELP_LINES = [
  `GBV support/referrals: Call ${PRIMARY_KENYA_GBV_CONTACT.displayPhone} (${PRIMARY_KENYA_GBV_CONTACT.availability}).`,
  `Police/emergency services: Call ${KENYA_POLICE_EMERGENCY_CONTACT.displayPhone}.`,
  'Medical care: Go to the nearest public health facility or hospital and ask about urgent care options.',
] as const;

export const KENYA_IMMEDIATE_HELP_TEXT = KENYA_IMMEDIATE_HELP_LINES
  .map(line => `- ${line}`)
  .join('\n');

export const LEGAL_ASSISTANT_UNAVAILABLE_MESSAGE =
  `Local AI is not ready yet. Your message is saved on this phone. For help now, call ${PRIMARY_KENYA_GBV_CONTACT.displayPhone}. In an emergency, call ${KENYA_POLICE_EMERGENCY_CONTACT.displayPhone}.`;

export const KENYA_SUPPORT_SOURCE_LABELS = [
  'SafeRide Kenya support catalog',
  'HAK 1195 GBV Helpline',
  'Kenya National Police Service emergency contacts',
] as const;

export const OFFLINE_CHAT_RESPONSES = {
  greeting:
    `Hi. SafeRide can save this chat on your phone. If you need help now:\n\n` +
    `${KENYA_IMMEDIATE_HELP_TEXT}\n\n` +
    `You can ask about reporting, medical care, evidence, or support contacts.\n\n` +
    `No provider received this chat.`,
  reporting:
    `Basic Kenya reporting options. Not legal advice:\n\n` +
    `- You can report at a police station and ask for the Gender Desk officer\n` +
    `- Ask about a P3 form if medical documentation is needed\n` +
    `- Call ${PRIMARY_KENYA_GBV_CONTACT.displayPhone} for GBV support\n\n` +
    `Your message is saved on this phone. No provider received this chat.`,
  medical:
    `Health support options:\n\n` +
    `- Go to the nearest public health facility or hospital as soon as you can\n` +
    `- Ask a clinician about PEP, emergency contraception, STI care, and injury documentation\n` +
    `- You can seek medical care before deciding whether to report\n\n` +
    `Your message is saved on this phone.`,
  support:
    `Kenya support contacts:\n\n` +
    `- ${PRIMARY_KENYA_GBV_CONTACT.label}: ${PRIMARY_KENYA_GBV_CONTACT.displayPhone} (${PRIMARY_KENYA_GBV_CONTACT.availability})\n` +
    `- ${KENYA_POLICE_EMERGENCY_CONTACT.label}: ${KENYA_POLICE_EMERGENCY_CONTACT.displayPhone}\n` +
    `- Medical care: nearest public health facility or hospital\n\n` +
    `Your message is saved on this phone.`,
  default:
    `Your message is saved on this phone. Help options:\n\n` +
    `${KENYA_IMMEDIATE_HELP_TEXT}\n\n` +
    `No provider received this chat.`,
} as const;
