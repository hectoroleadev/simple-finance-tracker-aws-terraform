const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const ITEM_HISTORY_TABLE = process.env.ITEM_HISTORY_TABLE_NAME;

exports.handler = async (event) => {
    console.log("Stream Event:", JSON.stringify(event));

    for (const record of event.Records) {
        const eventName = record.eventName; // INSERT, MODIFY, REMOVE
        const dynamodb = record.dynamodb;

        let itemId;
        let itemData;
        let type;

        if (eventName === "INSERT") {
            itemData = unmarshall(dynamodb.NewImage);
            itemId = itemData.id;
            type = "create";
        } else if (eventName === "MODIFY") {
            itemData = unmarshall(dynamodb.NewImage);
            itemId = itemData.id;
            type = "update";
        } else if (eventName === "REMOVE") {
            itemData = unmarshall(dynamodb.OldImage);
            itemId = itemData.id;
            type = "delete";
        }

        if (itemId) {
            const historyEntry = {
                itemId: itemId,
                timestamp: new Date().toISOString(),
                type: type,
                name: itemData.name,
                amount: itemData.amount,
                category: itemData.category,
                userId: itemData.userId, // Propagate userId for easier querying
                raw: itemData // Keep full copy just in case
            };

            console.log("Saving history entry:", JSON.stringify(historyEntry));

            try {
                await docClient.send(new PutCommand({
                    TableName: ITEM_HISTORY_TABLE,
                    Item: historyEntry
                }));
            } catch (err) {
                console.error("Error saving history entry:", err);
            }
        }
    }

    return { status: "success" };
};
