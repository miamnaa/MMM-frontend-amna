export const environment = {
  production: true,
  // Auth and Projects have a real backend behind them (API-REFERENCE.md).
  // DatasetService/ExperimentService return empty on their own until their
  // routes exist - no flag needed here to switch them off.
  apiBaseUrl: 'https://mmm-back-end-anas.onrender.com/api/v1',
  entra: {
    clientId: 'fa733969-d53d-46ed-81fc-119c740a5cc9',
    tenantId: 'd5619769-1863-41fe-86e3-95000d84f2a6',
    apiScope: 'api://fa733969-d53d-46ed-81fc-119c740a5cc9/access_as_user',
  },
  /**
   * Real xAI key for the direct-from-browser Grok call in grok.service.ts -
   * by explicit request, not the usual pattern. Unlike the Entra IDs above
   * (public OAuth identifiers, safe to ship), this is a real secret and
   * shipping it here means it's readable in the built browser bundle by
   * anyone who opens dev tools. Left blank on purpose - set the real
   * deployment key here (or via a build-time replace) before shipping.
   */
  grokApiKey: '',
};
