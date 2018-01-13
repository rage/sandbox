require 'rest_client'

post_url = 'http://localhost:3231/tasks.json'

File.open('poutput.tar', 'r') do |tar_file|
  RestClient.post post_url, file: tar_file, notify: 'lolled', token: 'secret_token'
end
