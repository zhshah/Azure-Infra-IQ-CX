# Microsoft Entra ID — App Registration Setup

Azure Infra IQ signs users in with **Microsoft Entra ID** (Azure AD) using MSAL
(authorization-code + PKCE, **no client secret**). You create one **Single-page
application (SPA)** app registration and pass its IDs to the deployment script.

> The backend authenticates to Azure for **scanning** with a **Managed Identity**
> (in the cloud) — that is separate from this user sign-in app registration.

---

## 1. Create the app registration

1. Azure Portal → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Configure:
   - **Name:** `Azure Infra IQ` (or your preferred name)
   - **Supported account types:** *Accounts in this organizational directory only*
   - **Redirect URI:** choose **Single-page application (SPA)** and leave the URL
     blank for now (the deployment script adds it automatically after deploy).
3. Click **Register**.

## 2. Note the two required values

On the app's **Overview** page, copy:

| Value | Used as |
|-------|---------|
| **Application (client) ID** | `-EntraAppClientId` |
| **Directory (tenant) ID**   | `-EntraTenantId`   |

## 3. API permissions (delegated)

1. **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**.
2. Add: `openid`, `profile`, `email`, **`User.Read`**.
3. Click **Grant admin consent for <your organization>** (requires an admin).

> `User.Read` lets the app show the signed-in user's name and photo. It is consented
> by default in most tenants.

## 4. Redirect URI (after deployment)

The deployment script **auto-registers** the Container App URL as a SPA redirect URI.
If it could not (insufficient Graph rights), add it manually:

1. App registration → **Authentication** → **Single-page application** → **Add URI**.
2. Add your app URL, for example:
   ```
   https://<your-container-app>.<region>.azurecontainerapps.io/
   ```
3. **Save**.

> For **local development**, `http://localhost:8080` and `http://localhost:5173`
> are also valid SPA redirect URIs you can add here.

---

That's it — the customer now provides `-EntraAppClientId` and `-EntraTenantId` to
`Scripts/deploy-automated.ps1` (or types them when prompted).
