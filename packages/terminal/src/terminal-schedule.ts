import type { TerminalSchedule, TerminalScheduleWindow } from '@aviator/shared';

export interface TerminalScheduleEvaluation { allowed:boolean; reason:string|null; matchedWindowId:string|null; }

const weekdayIndex:Record<string,number>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};

export function evaluateTerminalSchedule(schedule:TerminalSchedule|null,date:Date):TerminalScheduleEvaluation{
  if(!schedule||schedule.mode==='ALWAYS')return{allowed:true,reason:null,matchedWindowId:null};
  const local=localParts(date,schedule.timezone);
  const matched=schedule.windows.find(window=>matchesWindow(window,local.day,local.minutes));
  if(schedule.mode==='ALLOW_WINDOWS')return matched?{allowed:true,reason:null,matchedWindowId:matched.id}:{allowed:false,reason:'FORA_DO_HORARIO_PERMITIDO',matchedWindowId:null};
  return matched?{allowed:false,reason:'INTERVALO_BLOQUEADO',matchedWindowId:matched.id}:{allowed:true,reason:null,matchedWindowId:null};
}

function localParts(date:Date,timezone:string){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const get=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)?.value??'';
  return{day:weekdayIndex[get('weekday')]??0,minutes:Number(get('hour'))*60+Number(get('minute'))};
}

function matchesWindow(window:TerminalScheduleWindow,day:number,minutes:number){
  const start=toMinutes(window.startTime);const end=toMinutes(window.endTime);
  if(start===end)return window.days.includes(day);
  if(start<end)return window.days.includes(day)&&minutes>=start&&minutes<end;
  const previousDay=(day+6)%7;
  return(window.days.includes(day)&&minutes>=start)||(window.days.includes(previousDay)&&minutes<end);
}

function toMinutes(time:string){const[hour,minute]=time.split(':').map(Number);return hour*60+minute;}
