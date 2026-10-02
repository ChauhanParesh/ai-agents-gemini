// Example "direct API call" tool: hits a plain REST API directly with fetch,
// no MCP or SDK involved. Uses Open-Meteo (free, no API key) to demonstrate
// the pattern; swap in any HTTP API you actually need.

export const directApiToolDefs = [
  {
    name: 'get_weather',
    description: 'Get the current weather for a city by calling a weather REST API directly.',
    input_schema: {
      type: 'object',
      properties: { city: { type: 'string', description: 'City name, e.g. "Mumbai"' } },
      required: ['city'],
    },
  },
];

async function geocode(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`;
  const res = await fetch(url);
  const data = await res.json();
  const hit = data.results?.[0];
  if (!hit) throw new Error(`Could not find location "${city}"`);
  return { lat: hit.latitude, lon: hit.longitude, name: hit.name, country: hit.country };
}

export async function runDirectApiTool(name, input) {
  if (name === 'get_weather') {
    const { lat, lon, name: place, country } = await geocode(input.city);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,relative_humidity_2m`;
    const res = await fetch(url);
    const data = await res.json();
    const c = data.current;
    return `Weather in ${place}, ${country}: ${c.temperature_2m}°C, humidity ${c.relative_humidity_2m}%, wind ${c.wind_speed_10m} km/h`;
  }
  throw new Error(`Unknown direct API tool: ${name}`);
}
