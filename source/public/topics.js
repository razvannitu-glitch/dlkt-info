/** Stable public topic IDs shared by validation, saved editions and sharing. */
export const PUBLIC_TOPICS = [
    'technology', 'business', 'regulation', 'opportunities',
    'science', 'environment', 'health', 'public-affairs', 'world', 'digital-life', 'culture',
    'money', 'space', 'weather', 'energy', 'work-education', 'housing', 'travel', 'food', 'sport', 'other',
];
/** Editorial categories; coverage depends on the current, attributed source records. */
export const TOPIC_LABELS = Object.freeze({
    technology: 'AI & technology', business: 'Economy & business', regulation: 'Rights & rules', opportunities: 'Opportunities & deadlines',
    science: 'Science & discoveries', environment: 'Climate & environment', health: 'Health & wellbeing', 'public-affairs': 'Politics & society',
    world: 'World & security', 'digital-life': 'Cybersecurity & digital rights', culture: 'Culture & entertainment', money: 'Money & cost of living',
    space: 'Space', weather: 'Weather & emergencies', energy: 'Energy', 'work-education': 'Work & education', housing: 'Housing & cities',
    travel: 'Travel & mobility', food: 'Food & consumer safety', sport: 'Sport', other: 'Other topics',
});
export const TOPIC_DESCRIPTIONS = Object.freeze({
    technology: 'AI, digital technology and software releases', business: 'Economic developments, markets and businesses',
    regulation: 'Rights, public rules and legal publications', opportunities: 'Opportunities, notices and useful deadlines; verify eligibility',
    science: 'Research findings and discoveries', environment: 'Climate, nature and environmental developments', health: 'Public health and medical developments; source jurisdiction applies',
    'public-affairs': 'Public decisions, government and society', world: 'International developments and security',
    'digital-life': 'Cybersecurity, privacy and digital rights', culture: 'Arts, culture and entertainment', money: 'Household money, prices and consumer finance',
    space: 'Space research, missions and astronomy', weather: 'Weather developments and published emergency information; not a personal alert service',
    energy: 'Energy supply, technology and policy', 'work-education': 'Employment, skills, learning and education', housing: 'Homes, planning and city life',
    travel: 'Travel, transport and mobility', food: 'Food, product safety and consumer notices', sport: 'Sport developments and participation',
    other: 'Source-checked publications without a confirmed topic label; not an inferred personal interest',
});
