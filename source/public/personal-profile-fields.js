import { LOCAL_NEEDS } from './personal-contracts.js';
/** The initial local pilot is explicit; existing saved cities are preserved, never guessed. */
export function createPersonalProfileFields(prefix) {
    const city = document.getElementById(prefix + '-city');
    const needs = document.getElementById(prefix + '-local-needs');
    const cityName = document.getElementById(prefix + '-city-name');
    if (!city || !needs || !cityName)
        throw new Error('PERSONAL_PROFILE_FIELDS_MISSING');
    const fields = { city, needs, cityName };
    const choices = LOCAL_NEEDS.map(need => {
        const label = document.createElement('label'), input = document.createElement('input');
        input.type = 'checkbox';
        input.name = 'localNeeds';
        input.value = need;
        const title = document.createTextNode(need.charAt(0).toUpperCase() + need.slice(1).replaceAll('-', ' '));
        label.append(input, title);
        fields.needs.append(label);
        return { need, input };
    });
    function cityValue(value) {
        fields.city.value = value ?? '683506';
        fields.city.checked = value !== null;
        fields.cityName.textContent = value === null || value === '683506' ? 'Include Bucharest, Romania' : 'Previously saved city';
    }
    function render(profile) {
        cityValue(profile.cityId);
        for (const { need, input } of choices)
            input.checked = profile.localNeeds.includes(need);
    }
    function clear() { cityValue(null); for (const { input } of choices)
        input.checked = false; }
    clear();
    return { render, clear,
        read: () => ({ cityId: fields.city.checked ? fields.city.value : null, localNeeds: choices.filter(({ input }) => input.checked).map(({ need }) => need) }),
        setBusy: value => { fields.city.disabled = value; for (const { input } of choices)
            input.disabled = value; },
    };
}
