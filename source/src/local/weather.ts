import {object,finite,stamp,validWeatherSymbol,type City,type LocalCard,type WeatherSymbol} from './contracts.js';
export function weatherUrl(city:City):string{return`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${city.lat.toFixed(4)}&lon=${city.lon.toFixed(4)}`;}
/** Forecasts are not observations or safety alerts. Only complete hourly windows are shown. */
export function weatherCard(value:unknown,city:City,checkedAt:string,now:number):LocalCard{
 if(!object(value)||value.type!=='Feature'||!object(value.geometry)||!Array.isArray(value.geometry.coordinates)||!finite(value.geometry.coordinates[0],-180,180)||!finite(value.geometry.coordinates[1],-90,90)||Math.abs(Number(value.geometry.coordinates[0])-city.lon)>.002||Math.abs(Number(value.geometry.coordinates[1])-city.lat)>.002||!object(value.properties)||!object(value.properties.meta)||!object(value.properties.meta.units)||!Array.isArray(value.properties.timeseries))throw Error('WEATHER_IDENTITY_INVALID');
 const meta=value.properties.meta,units=meta.units as Record<string,unknown>;if(!stamp(meta.updated_at)||Date.parse(meta.updated_at)>now+300000||Date.parse(meta.updated_at)<now-18*3600000||units.air_temperature!=='celsius'||units.wind_speed!=='m/s'||units.precipitation_amount!=='mm')throw Error('WEATHER_UNITS_OR_AGE_INVALID');
 const start=Math.ceil(now/3600000)*3600000,end=start+6*3600000;
 const samples=value.properties.timeseries.filter((x:unknown)=>object(x)&&stamp(x.time)&&Date.parse(x.time)>=start&&Date.parse(x.time)<=end);
 if(samples.length!==7)throw Error('WEATHER_HOURLY_COVERAGE_MISSING');
 const rows=samples.map((x:unknown,i:number)=>{if(!object(x)||!stamp(x.time)||Date.parse(x.time)!==start+i*3600000||!object(x.data)||!object(x.data.instant)||!object(x.data.instant.details))throw Error('WEATHER_INTERVAL_INVALID');const d=x.data.instant.details;const period=x.data.next_1_hours;const rain=object(period)&&object(period.details)?period.details.precipitation_amount:null;if(!finite(d.air_temperature,-95,65)||!finite(d.wind_speed,0,120)||(i<6&&!finite(rain,0,500)))throw Error('WEATHER_VALUE_INVALID');return{at:x.time,temp:d.air_temperature,wind:d.wind_speed*3.6,rain:typeof rain==='number'?rain:0};});
 const tempMin=Math.min(...rows.map(r=>r.temp)),tempMax=Math.max(...rows.map(r=>r.temp)),windMax=Math.max(...rows.map(r=>r.wind));const rainTotal=rows.slice(0,6).reduce((n,r)=>n+r.rain,0);
 const f=(x:number)=>Number(x.toFixed(1)).toString();const text=`Hourly forecast temperatures ${f(tempMin)}–${f(tempMax)} °C. Total precipitation ${f(rainTotal)} mm over the six hourly periods. Highest hourly wind-speed forecast ${f(windMax)} km/h (not gusts).`;
 const symbols=new Map<number,string|null>();
 for(const sample of value.properties.timeseries){
  if(!object(sample)||!stamp(sample.time))continue;const at=Date.parse(sample.time);
  if(at<Math.floor(now/3600000)*3600000||at>=end||at%3600000!==0)continue;
  if(symbols.has(at)){symbols.set(at,null);continue;}
  const period=object(sample.data)&&object(sample.data.next_1_hours)?sample.data.next_1_hours:null;
  const symbol=period&&object(period.summary)?period.summary.symbol_code:null;symbols.set(at,validWeatherSymbol(symbol)?symbol:null);
 }
 const weatherSymbols:WeatherSymbol[]=[...symbols].sort(([a],[b])=>a-b).flatMap(([at,symbol])=>symbol===null?[]:[{at:new Date(at).toISOString(),symbol}]);
 return{id:`weather:${city.id}:${start}`,kind:'forecast',title:'Weather for the next six full hours',text,publisher:'MET Norway',sourceUrl:weatherUrl(city),sourceUpdatedAt:meta.updated_at,checkedAt,validFrom:new Date(start).toISOString(),validTo:new Date(end).toISOString(),facts:rows.slice(0,6).map(r=>`${r.at} | ${f(r.temp)} °C | precipitation over next hour: ${f(r.rain)} mm | wind: ${f(r.wind)} km/h`),boundary:'City-centre forecast, not measured conditions or official local warnings. Figures are converted and combined by DLKT; forecasts can change.',...(weatherSymbols.length?{weatherSymbols}:{} )};
}
