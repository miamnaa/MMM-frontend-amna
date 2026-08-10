export const environment = {
  production: false,
  /**
   * Per-domain switches rather than one global flag: the real backend only
   * has Auth and Projects endpoints today (see API-REFERENCE.md). Datasets
   * and Experiments have no route at all yet, so pointing those services at
   * apiBaseUrl would just 404 — they stay mocked until their own backends
   * land, independently of whatever auth/projects are doing.
   *
   * Auth and Projects are live against the shared Render Dev instance, so
   * `ng serve` shows real signed-in data rather than the sample account. If
   * you're running the NestJS API locally instead, switch apiBaseUrl below
   * to http://localhost:3000/api/v1.
   */
  mock: {
    auth: false,
    projects: false,
    datasets: true,
    experiments: true,
  },
  apiBaseUrl: 'https://mmm-back-end-anas.onrender.com/api/v1',
  /**
   * Real Entra app registration - the backend already validates tokens
   * issued for this exact client/tenant, so local dev talks to the same
   * identity as production. Only the API base URL above is mocked out.
   */
  entra: {
    clientId: 'fa733969-d53d-46ed-81fc-119c740a5cc9',
    tenantId: 'd5619769-1863-41fe-86e3-95000d84f2a6',
    apiScope: 'api://fa733969-d53d-46ed-81fc-119c740a5cc9/access_as_user',
  },
};
