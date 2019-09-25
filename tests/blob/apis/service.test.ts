import * as assert from "assert";

import {
  Aborter,
  ContainerURL,
  ServiceURL,
  SharedKeyCredential,
  StorageURL
} from "@azure/storage-blob";

import BlobConfiguration from "../../../src/blob/BlobConfiguration";
import Server from "../../../src/blob/BlobServer";
import {
  EMULATOR_ACCOUNT_KIND,
  EMULATOR_ACCOUNT_SKUNAME
} from "../../../src/blob/utils/constants";
import { StoreDestinationArray } from "../../../src/common/persistence/IExtentStore";
import {
  EMULATOR_ACCOUNT_KEY,
  EMULATOR_ACCOUNT_NAME,
  getUniqueName,
  rmRecursive
} from "../../testutils";

describe("ServiceAPIs", () => {
  // TODO: Create a server factory as tests utils
  const host = "127.0.0.1";
  const port = 11000;
  const metadataDbPath = "__blobTestsStorage__";
  const extentDbPath = "__blobExtentTestsStorage__";
  const persistencePath = "__blobTestsPersistence__";
  const DEFUALT_QUEUE_PERSISTENCE_ARRAY: StoreDestinationArray = [
    {
      persistencyId: "blobTest",
      persistencyPath: persistencePath,
      maxConcurrency: 10
    }
  ];
  const config = new BlobConfiguration(
    host,
    port,
    metadataDbPath,
    extentDbPath,
    DEFUALT_QUEUE_PERSISTENCE_ARRAY,
    false
  );

  // TODO: Create serviceURL factory as tests utils
  const baseURL = `http://${host}:${port}/devstoreaccount1`;
  const serviceURL = new ServiceURL(
    baseURL,
    StorageURL.newPipeline(
      new SharedKeyCredential(EMULATOR_ACCOUNT_NAME, EMULATOR_ACCOUNT_KEY),
      {
        retryOptions: { maxTries: 1 }
      }
    )
  );

  let server: Server;

  before(async () => {
    server = new Server(config);
    await server.start();
  });

  after(async () => {
    await server.close();
    await rmRecursive(metadataDbPath);
    await rmRecursive(extentDbPath);
    await rmRecursive(persistencePath);
  });

  it("GetServiceProperties", async () => {
    const result = await serviceURL.getProperties(Aborter.none);

    assert.ok(typeof result.requestId);
    assert.ok(result.requestId!.length > 0);
    assert.ok(typeof result.version);
    assert.ok(result.version!.length > 0);

    if (result.cors && result.cors!.length > 0) {
      assert.ok(result.cors![0].allowedHeaders.length > 0);
      assert.ok(result.cors![0].allowedMethods.length > 0);
      assert.ok(result.cors![0].allowedOrigins.length > 0);
      assert.ok(result.cors![0].exposedHeaders.length > 0);
      assert.ok(result.cors![0].maxAgeInSeconds >= 0);
    }
    assert.equal(
      result._response.request.headers.get("x-ms-client-request-id"),
      result.clientRequestId
    );
  });

  it("SetServiceProperties", async () => {
    const serviceProperties = await serviceURL.getProperties(Aborter.none);

    serviceProperties.logging = {
      deleteProperty: true,
      read: true,
      retentionPolicy: {
        days: 5,
        enabled: true
      },
      version: "1.0",
      write: true
    };

    serviceProperties.minuteMetrics = {
      enabled: true,
      includeAPIs: true,
      retentionPolicy: {
        days: 4,
        enabled: true
      },
      version: "1.0"
    };

    serviceProperties.hourMetrics = {
      enabled: true,
      includeAPIs: true,
      retentionPolicy: {
        days: 3,
        enabled: true
      },
      version: "1.0"
    };

    const newCORS = {
      allowedHeaders: "*",
      allowedMethods: "GET",
      allowedOrigins: "example.com",
      exposedHeaders: "*",
      maxAgeInSeconds: 8888
    };
    if (!serviceProperties.cors) {
      serviceProperties.cors = [newCORS];
    } else if (serviceProperties.cors!.length < 5) {
      serviceProperties.cors.push(newCORS);
    }

    if (!serviceProperties.deleteRetentionPolicy) {
      serviceProperties.deleteRetentionPolicy = {
        days: 2,
        enabled: false
      };
    }

    const result_set = await serviceURL.setProperties(
      Aborter.none,
      serviceProperties
    );
    assert.equal(
      result_set._response.request.headers.get("x-ms-client-request-id"),
      result_set.clientRequestId
    );

    const result = await serviceURL.getProperties(Aborter.none);
    assert.ok(typeof result.requestId);
    assert.ok(result.requestId!.length > 0);
    assert.ok(typeof result.version);
    assert.ok(result.version!.length > 0);
    assert.deepEqual(result.hourMetrics, serviceProperties.hourMetrics);
    assert.equal(
      result._response.request.headers.get("x-ms-client-request-id"),
      result.clientRequestId
    );
  });

  it("ListContainers with default parameters", async () => {
    const result = await serviceURL.listContainersSegment(Aborter.none);
    assert.ok(typeof result.requestId);
    assert.ok(result.requestId!.length > 0);
    assert.ok(typeof result.version);
    assert.ok(result.version!.length > 0);

    assert.ok(result.serviceEndpoint.length > 0);
    assert.ok(result.containerItems!.length >= 0);

    if (result.containerItems!.length > 0) {
      const container = result.containerItems![0];
      assert.ok(container.name.length > 0);
      assert.ok(container.properties.etag.length > 0);
      assert.ok(container.properties.lastModified);
    }
    assert.equal(
      result._response.request.headers.get("x-ms-client-request-id"),
      result.clientRequestId
    );
  });

  it("ListContainers with all parameters configured", async () => {
    const containerNamePrefix = getUniqueName("container");
    const containerName1 = `${containerNamePrefix}x1`;
    const containerName2 = `${containerNamePrefix}x2`;
    const containerURL1 = ContainerURL.fromServiceURL(
      serviceURL,
      containerName1
    );
    const containerURL2 = ContainerURL.fromServiceURL(
      serviceURL,
      containerName2
    );
    await containerURL1.create(Aborter.none, { metadata: { key: "val" } });
    await containerURL2.create(Aborter.none, { metadata: { key: "val" } });

    const result1 = await serviceURL.listContainersSegment(
      Aborter.none,
      undefined,
      {
        include: "metadata",
        maxresults: 1,
        prefix: containerNamePrefix
      }
    );

    assert.ok(result1.nextMarker);
    assert.equal(result1.containerItems!.length, 1);
    assert.ok(result1.containerItems![0].name.startsWith(containerNamePrefix));
    assert.ok(result1.containerItems![0].properties.etag.length > 0);
    assert.ok(result1.containerItems![0].properties.lastModified);
    assert.ok(!result1.containerItems![0].properties.leaseDuration);
    assert.ok(!result1.containerItems![0].properties.publicAccess);
    assert.deepEqual(
      result1.containerItems![0].properties.leaseState,
      "available"
    );
    assert.deepEqual(
      result1.containerItems![0].properties.leaseStatus,
      "unlocked"
    );
    assert.deepEqual(result1.containerItems![0].metadata!.key, "val");
    assert.equal(
      result1._response.request.headers.get("x-ms-client-request-id"),
      result1.clientRequestId
    );

    const result2 = await serviceURL.listContainersSegment(
      Aborter.none,
      result1.nextMarker,
      {
        include: "metadata",
        maxresults: 1,
        prefix: containerNamePrefix
      }
    );

    assert.equal(result2.containerItems!.length, 1);
    assert.ok(result2.containerItems![0].name.startsWith(containerNamePrefix));
    assert.ok(result2.containerItems![0].properties.etag.length > 0);
    assert.ok(result2.containerItems![0].properties.lastModified);
    assert.ok(!result2.containerItems![0].properties.leaseDuration);
    assert.ok(!result2.containerItems![0].properties.publicAccess);
    assert.deepEqual(
      result2.containerItems![0].properties.leaseState,
      "available"
    );
    assert.deepEqual(
      result2.containerItems![0].properties.leaseStatus,
      "unlocked"
    );
    assert.deepEqual(result2.containerItems![0].metadata!.key, "val");

    await containerURL1.delete(Aborter.none);
    await containerURL2.delete(Aborter.none);
  });

  it("get Account info", async () => {
    const result = await serviceURL.getAccountInfo(Aborter.none);
    assert.equal(result.accountKind, EMULATOR_ACCOUNT_KIND);
    assert.equal(result.skuName, EMULATOR_ACCOUNT_SKUNAME);
    assert.equal(
      result._response.request.headers.get("x-ms-client-request-id"),
      result.clientRequestId
    );
  });
});