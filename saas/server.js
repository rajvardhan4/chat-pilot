/**
 * Plain-JavaScript entry point.
 *
 * The real server is src/server.ts, which Node runs directly by stripping the
 * types (Node 22.18+ / 24). Some managed hosts, though, ask for a startup file
 * by name and only offer a .js box - Hostinger's Node app manager is one. This
 * file exists so that box has something to point at, and so `node server.js`
 * works anywhere without arguing about extensions.
 *
 * It is one import on purpose: no logic lives here, so there is nothing to keep
 * in sync with the real entry point.
 */
import './src/server.ts';
