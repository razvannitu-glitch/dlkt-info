import {readPersistenceConfiguration} from '../persistence/config.js';
import {projectProvisioningControl,type ProvisioningProjection} from '../provisioning/index.js';
import type {Environment} from './http.js';
export async function accountReadiness(env:Environment,request:typeof fetch=fetch,supplied?:ProvisioningProjection){
 const configuration=readPersistenceConfiguration(env);
 const enabledFlag=env.DLKT_INFO_ACCOUNT_BRIDGE_ENABLED==='1',emailReady=env.DLKT_INFO_AUTH_EMAIL_READY==='1';
 if(configuration.state!=='ready'||!enabledFlag||!emailReady)return {enabled:false,configuration,provisioning:null};
 const provisioning=supplied??await projectProvisioningControl({environment:env,fetch:request});
 return {enabled:provisioning.capabilities.auth&&provisioning.capabilities.persistence&&provisioning.schemaVerified,configuration,provisioning};
}
