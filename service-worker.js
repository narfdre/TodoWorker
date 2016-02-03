/* global importScripts, Response, Request, clients, toolbox, self, URL, caches, Promise, fetch, window, Headers, console, PouchDB*/
'use strict';
importScripts('js/libs/serviceworker-cache-polyfill.js');
importScripts('js/libs/serviceworker-toolbox.js');
importScripts('js/libs/pouchdb-4.0.0.min.js');

var local = new PouchDB('todo');

console.log('SW startup');

self.addEventListener('install', function (event) {
  console.log('SW installing...');

  event.waitUntil(
    caches.open('simple-sw-v1').then(function(cache) {
      return cache.addAll([
        '/index.html',
        'learn.json',
        '/node_modules/todomvc-common/base.css',
        '/node_modules/todomvc-app-css/index.css',
        '/node_modules/todomvc-common/base.js',
        '/node_modules/angular/angular.js',
        '/node_modules/angular-route/angular-route.js',
        '/js/app.js',
        '/js/controllers/todoCtrl.js',
        '/js/directives/todoEscape.js',
        '/js/directives/todoFocus.js',
        '/js/services/todoStorage.js',
        new Request ('https://c1.staticflickr.com/1/259/20458175786_9743eb0e58_k.jpg', {mode: 'no-cors'})
      ]);
    }));
});

self.onmessage = function(event){
  var object = event.data;
  if(object.topic === 'load cache'){
    caches.open('simple-sw-v1').then(function(cache) {
      fetch(object.url).then(function(response) {
        cache.put(object.url, response.clone());
      });
    });
  }
  console.log('MESSAGE RECEIVED IN SERVICE WORKER ', object.topic);
};

self.addEventListener('push', function(event){
  console.log('Received a push message', event);

  var title = 'TodoWorker';
  var body = 'There is a message from the server.';
  var icon = '/img/logo.ico';
  var tag = 'generic-push-message';
  var headers = new Headers();

  var localUserDb = new PouchDB('user');
  var token = '';

  event.waitUntil(localUserDb.get('auth-token', {
    include_docs: true,
  }).then(function(doc) {
    headers.append('Authorization', 'Bearer ' + doc.token);
    return fetch('/push/notification/notify', {headers: headers});
  })
  .then(function(response){
    if(response.status === 200){
      return response.json();
    }else{
      throw new Error();
    }
  })
  .then(function(data){
    if(data && data[0]){
        title = data[0].title;
        body = data[0].message;
        tag = data[0].tag;
        return self.registration.showNotification(title, {
          icon: icon,
          body: body,
          tag: tag
        });
    }else{
      throw new Error();
    }
  })
  .catch(function(){
    return self.registration.showNotification(title, {
      icon: icon,
      body: body,
      tag: tag
    });
  }));
});


self.addEventListener('notificationclick', function(event){
  console.log('On notification click: ', event.notification.tag);
  event.notification.close();

  event.waitUntil(clients.matchAll({
    type: 'window'
  }).then(function(clientList) {
    if(clientList.length > 0){
      clientList[0].focus();
    }else{
      return clients.openWindow('/');
    }
  }));
});

self.addEventListener('activate', function (event) {
  console.log('SW activating...');

  var remote = new PouchDB('http://localhost:5984/todo');

  PouchDB.sync(local, remote, {
    live: true,
    retry: true
  }).on('change', function (info) {
    // handle change
    console.log(info);
    if(info.direction === 'pull'){
      sendEventToClient('change', info);
    }
  }).on('paused', function () {
    sendEventToClient('paused');
  }).on('active', function () {
    sendEventToClient('active');
  }).on('denied', function (info) {
    sendEventToClient('denied', info);
  }).on('complete', function (info) {
    sendEventToClient('complete', info);
  }).on('error', function (err) {
    sendEventToClient('error', err);
  });

});

function sendEventToClient(topic, data){
  clients.matchAll({type: 'window'})
  .then(function(clientList) {
    if(clientList[0]){
      clientList[0].postMessage({topic: topic, data: data});
    }
  });
}

self.addEventListener('fetch', function (event) {
  var requestURL = new URL(event.request.url);
  var key;
  var result;
  var value;

  // console.log('SW fetching...');

  if(requestURL.pathname.indexOf('/api') > -1){
    toolbox.router.get('/api', function(request, values) {
      return new Response(200);
    });

    toolbox.router.get('/api/todos', function(request, values) {
      return local
        .allDocs({ include_docs: true })
        .then(function(docs){
          var cleanDocs = [];
          docs.rows.forEach(function(doc){
            doc.doc.id = doc.doc._id;
            cleanDocs.push(doc.doc);
          });
          return new Response(JSON.stringify(cleanDocs), {
            headers: { 'Content-Type': 'application/json' }
          });
        });
      });

    toolbox.router.get('/api/todos/:id', function(request, values) {
      return local
        .get(values.id)
        .then(function(doc){
          return new Response(JSON.stringify(doc), {
            headers: { 'Content-Type': 'application/json' }
          });
        })
        .catch(function(err){
          var opts = {
            'status': err.status,
            'statusText': err.name,
          };
          return new Response(err.message, opts);
        });
      });

    toolbox.router.post('/api/todos', function(request, values) {
      return request.json()
        .then(function(body){
          return local.post(body);
        })
        .then(function(doc){
          return new Response(JSON.stringify(doc), {
            headers: { 'Content-Type': 'application/json' }
          });
        });
    });

    toolbox.router.put('/api/todos/:id', function(request, values) {
      var newDoc;
      return request.json()
        .then(function(body){
          newDoc = body;
          return local.get(values.id);
        })
        .then(function(doc){
          doc.completed = newDoc.completed;
          doc.title = newDoc.title;
          return local.put(doc, doc._id, doc._rev);
        })
        .then(function(doc){
          return new Response(JSON.stringify(doc), {
            headers: { 'Content-Type': 'application/json' }
          });
        });
    });

    toolbox.router.delete('/api/todos/:id', function(request, values) {
      return local.get(values.id)
        .then(function(doc){
          return local.remove(doc._id, doc._rev);
        })
        .then(function(){
          return new Response();
        })
        .catch(function(err){
          var opts = {
            'status': err.status,
            'statusText': err.name,
          };
          return new Response(err.message, opts);
        });
    });
  }else{
    event.respondWith(
      caches.match(event.request).then(function(response) {
        return response || fetch(event.request);
      })
    );
  }
});
