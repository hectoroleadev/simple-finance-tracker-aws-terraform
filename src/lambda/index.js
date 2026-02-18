const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");
const { CognitoIdentityProviderClient, SignUpCommand, InitiateAuthCommand, ConfirmSignUpCommand } = require("@aws-sdk/client-cognito-identity-provider");
const { z } = require("zod");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const cognitoClient = new CognitoIdentityProviderClient({});

const ITEMS_TABLE = process.env.ITEMS_TABLE_NAME;
const HISTORY_TABLE = process.env.HISTORY_TABLE_NAME;
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID;

// Cognito Authentication Functions
async function signup(username, password, email) {
    const command = new SignUpCommand({
        ClientId: COGNITO_CLIENT_ID,
        Username: username,
        Password: password,
        UserAttributes: [{ Name: "email", Value: email }],
    });
    const response = await cognitoClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: "User registered successfully. Please confirm your email.", userSub: response.UserSub }),
    };
}

async function login(username, password) {
    const command = new InitiateAuthCommand({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: COGNITO_CLIENT_ID,
        AuthParameters: {
            USERNAME: username,
            PASSWORD: password,
        },
    });
    const response = await cognitoClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify(response.AuthenticationResult),
    };
}

async function confirmSignup(username, code) {
    const command = new ConfirmSignUpCommand({
        ClientId: COGNITO_CLIENT_ID,
        Username: username,
        ConfirmationCode: code,
    });
    await cognitoClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: "User confirmed successfully." }),
    };
}

async function refresh(refreshToken) {
    const command = new InitiateAuthCommand({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: COGNITO_CLIENT_ID,
        AuthParameters: {
            REFRESH_TOKEN: refreshToken,
        },
    });
    const response = await cognitoClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify(response.AuthenticationResult),
    };
}

// Validation Schemas
const FinanceItemSchema = z.object({
    id: z.string().uuid().or(z.string().regex(/^h\d+$/)), // Supports UUID and legacy IDs
    name: z.string().min(1),
    amount: z.number(),
    category: z.enum(["investments", "liquid_cash", "pending_payments", "retirement", "debt"]),
});

const HistoryEntrySchema = z.object({
    id: z.string(),
    date: z.string().datetime(),
    savings: z.number(),
    debt: z.number(),
    balance: z.number(),
    retirement: z.number(),
    year: z.number().optional(),
    month: z.string().optional(),
});

const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
};

exports.handler = async (event) => {
    console.log("Event:", JSON.stringify(event));

    // Support both HTTP API (v2) and REST API (v1)
    const method = event.httpMethod || event.requestContext?.http?.method;
    const path = event.path || event.rawPath;
    const userClaims = event.requestContext?.authorizer?.claims; // Extract claims

    if (method === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    try {
        if (path === "/auth/signup") {
            if (method === "POST") {
                const body = JSON.parse(event.body);
                const { username, password, email } = body;
                return await signup(username, password, email);
            }
        } else if (path === "/auth/login") {
            if (method === "POST") {
                const body = JSON.parse(event.body);
                const { username, password } = body;
                return await login(username, password);
            }
        } else if (path === "/auth/confirm-signup") {
            if (method === "POST") {
                const body = JSON.parse(event.body);
                const { username, code } = body;
                return await confirmSignup(username, code);
            }
        } else if (path === "/auth/refresh") {
            if (method === "POST") {
                const body = JSON.parse(event.body);
                const { refreshToken } = body;
                return await refresh(refreshToken);
            }
        } else if (path === "/items" || path === "/items/") {
            if (method === "GET") {
                return await getItems();
            } else if (method === "POST") {
                const body = JSON.parse(event.body);
                if (body.items) {
                    return await saveItems(body.items);
                }
            }
        } else if (path.startsWith("/items/") && method === "DELETE") {
            const id = path.split("/").pop();
            if (id) {
                return await deleteItem(id);
            } else {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ message: "Missing id in path" }),
                };
            }
        } else if (path === "/history") {
            if (method === "GET") {
                return await getHistory();
            } else if (method === "POST") {
                const body = JSON.parse(event.body);
                if (body.history) {
                    return await saveHistory(body.history);
                }
            }
        } else if (path.startsWith("/history/") && method === "DELETE") {
            const id = path.split("/").pop();
            if (id) {
                return await deleteHistoryItem(id);
            } else {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ message: "Missing id in path" }),
                };
            }
        }

        return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ message: "Not Found" }),
        };
    } catch (error) {
        console.error("Error:", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ message: "Internal Server Error", error: error.message }),
        };
    }
};

async function getItems() {
    const command = new ScanCommand({ TableName: ITEMS_TABLE });
    const response = await docClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ items: response.Items }),
    };
}

async function saveItems(items) {
    // Validation
    const validation = z.array(FinanceItemSchema).safeParse(items);
    if (!validation.success) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ message: "Invalid items format", errors: validation.error.format() }),
        };
    }

    if (items.length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ message: "No items to save" }) };
    }

    // DynamoDB BatchWrite limit is 25
    const chunks = chunkArray(items, 25);

    for (const chunk of chunks) {
        const putRequests = chunk.map((item) => ({
            PutRequest: { Item: item },
        }));

        const command = new BatchWriteCommand({
            RequestItems: {
                [ITEMS_TABLE]: putRequests,
            },
        });
        await docClient.send(command);
    }

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: "Items saved successfully" }),
    };
}

async function getHistory() {
    const command = new ScanCommand({ TableName: HISTORY_TABLE });
    const response = await docClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ history: response.Items }),
    };
}

async function saveHistory(historyEntries) {
    // Validation
    const validation = z.array(HistoryEntrySchema).safeParse(historyEntries);
    if (!validation.success) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ message: "Invalid history format", errors: validation.error.format() }),
        };
    }

    if (historyEntries.length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ message: "No history to save" }) };
    }

    const chunks = chunkArray(historyEntries, 25);

    for (const chunk of chunks) {
        const putRequests = chunk.map((entry) => ({
            PutRequest: { Item: entry },
        }));

        const command = new BatchWriteCommand({
            RequestItems: {
                [HISTORY_TABLE]: putRequests,
            },
        });
        await docClient.send(command);
    }

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: "History saved successfully" }),
    };
}

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

async function deleteItem(id) {
    const command = new DeleteCommand({
        TableName: ITEMS_TABLE,
        Key: { id },
    });
    await docClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: "Item deleted successfully" }),
    };
}

async function deleteHistoryItem(id) {
    const command = new DeleteCommand({
        TableName: HISTORY_TABLE,
        Key: { id },
    });
    await docClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: "History item deleted successfully" }),
    };
}
