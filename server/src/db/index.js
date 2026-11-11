import knex from 'knex';
import config from '../../knexfile.js';
import { wrapIdentifier } from './tenant.js';

// wrapIdentifier adds the current company's table prefix (see db/tenant.js).
export default knex({ ...config, wrapIdentifier });
