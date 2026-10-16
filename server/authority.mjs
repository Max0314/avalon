export class Authority {
  constructor(commit,fatal){this.commit=commit;this.fatal=fatal;this.tail=Promise.resolve();this.events=null;this.pending=0;this.failed=false;}
  publish(callback){if(this.events)this.events.push(callback);else callback();}
  run(work){
    if(this.pending>=256)return Promise.reject(Error('Queue full'));this.pending++;
    const result=this.tail.then(async()=>{
      if(this.failed)throw Error('Persistence unavailable');this.events=[];let value,error;
      try{value=await work();}catch(cause){error=cause;}
      try{await this.commit();}catch{this.events=null;this.failed=true;this.fatal();throw Error('Persistence unavailable');}
      const events=this.events;this.events=null;for(const callback of events)callback();if(error)throw error;return value;
    });this.tail=result.catch(()=>{}).finally(()=>this.pending--);return result;
  }
}
