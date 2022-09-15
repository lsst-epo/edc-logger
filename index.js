
const { ApolloServer, gql } = require('apollo-server-cloud-functions');
const Knex = require('knex');
const { Logging } = require('@google-cloud/logging');

// Set up a variable to hold our connection pool. It would be safe to
// initialize this right away, but we defer its instantiation to ease
// testing different configurations.
let pool;
const PROJECT_ID = "skyviewer";
const LOG_NAME = "edc-logger-logs"
// create the logging  client
const logging = new Logging( { PROJECT_ID } );
// Selects the log to write to
const log = logging.logSync(LOG_NAME);

const createPoolAndEnsureSchema = async () =>
  await createPool()
    .then(pool => {
      return pool;
    })
    .catch(err => {
      throw err;
    });

// Initialize Knex, a Node.js SQL query builder library with built-in connection pooling.
const createPool = async () => {
    // Configure which instance and what database user to connect with.
    // Remember - storing secrets in plaintext is potentially unsafe. Consider using
    // something like https://cloud.google.com/kms/ to help keep secrets secret.
    const config = {pool: {}};
  
    // [START cloud_sql_postgres_knex_limit]
    // 'max' limits the total number of concurrent connections this pool will keep. Ideal
    // values for this setting are highly variable on app design, infrastructure, and database.
    config.pool.max = 5;
    // 'min' is the minimum number of idle connections Knex maintains in the pool.
    // Additional connections will be established to meet this value unless the pool is full.
    config.pool.min = 5;
    // [END cloud_sql_postgres_knex_limit]
  
    // [START cloud_sql_postgres_knex_timeout]
    // 'acquireTimeoutMillis' is the number of milliseconds before a timeout occurs when acquiring a
    // connection from the pool. This is slightly different from connectionTimeout, because acquiring
    // a pool connection does not always involve making a new connection, and may include multiple retries.
    // when making a connection
    config.pool.acquireTimeoutMillis = 60000; // 60 seconds
    // 'createTimeoutMillis` is the maximum number of milliseconds to wait trying to establish an
    // initial connection before retrying.
    // After acquireTimeoutMillis has passed, a timeout exception will be thrown.
    config.pool.createTimeoutMillis = 30000; // 30 seconds
    // 'idleTimeoutMillis' is the number of milliseconds a connection must sit idle in the pool
    // and not be checked out before it is automatically closed.
    config.pool.idleTimeoutMillis = 600000; // 10 minutes
    // [END cloud_sql_postgres_knex_timeout]
  
    // [START cloud_sql_postgres_knex_backoff]
    // 'knex' uses a built-in retry strategy which does not implement backoff.
    // 'createRetryIntervalMillis' is how long to idle after failed connection creation before trying again
    config.pool.createRetryIntervalMillis = 200; // 0.2 seconds
    // [END cloud_sql_postgres_knex_backoff]
  
    if (process.env.DB_HOST) {
        return createTcpPool(config);
    }
  };

const createTcpPool = async config => {
    // Extract host and port from socket address
    const dbSocketAddr = process.env.DB_HOST.split(':');

    // Establish a connection to the database
    return Knex({
        client: 'pg',
        connection: {
        user: process.env.DB_USER, 
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        host: dbSocketAddr[0],
        port: dbSocketAddr[1],
        }
    });
};

// Construct a schema, using GraphQL schema language
const typeDefs = gql`
    type EDCLog {
        edc_logger_id: ID
        application_name: String
        run_id: String
        notes: String
    }
    type Query {
        edcLogs: [EDCLog]
    }
    type Mutation {
        addEdcLog(runId: String, appName: String, notes: String): EDCLog
    }
`;

const setEdcLog = async (app_name, run_id, notes) => {
    let res = await pool("edc_logger").insert([{ application_name: app_name ,  run_id: run_id ,  notes: notes }]);
    return res;
}

const getEdcLogs = async () => {
    let res = await pool.select("*").from("edc_logger");
    return res;
}

// Provide resolver functions for your schema fields
const resolvers = {
    Query: {
        async edcLogs(parent, args, context, info) {
            // Ensure that there is a connection to the DB
            pool = pool || (await createPoolAndEnsureSchema())
            // if(args && args.appName && args.runId && args.notes) {
                let res = await getEdcLogs();
                return res;
            // } else {
            //     writeLog("The required arguments were not passed to the edc-logger schema!", "ERROR")
            // }
        }
    },
    Mutation: {
      async addEdcLog(parent, args, context, info) {
          // Ensure that there is a connection to the DB
          pool = pool || (await createPoolAndEnsureSchema())
          if(args && args.appName && args.runId && args.notes) {
              let res = await setEdcLog(args.appName, args.runId, args.notes);
              return res;
          } else {
              writeLog("The required arguments were not passed to the edc-logger schema!", "ERROR")
          }
      }
    }
  };

  const server = new ApolloServer({
    typeDefs,
    resolvers,
  });
  
  async function writeLog(text, sev) {
      // Writes the log entry
      await log.write(log.entry({ resource: { type: "global" }, severity: sev }, text));
  }
  
  exports.handler = server.createHandler();